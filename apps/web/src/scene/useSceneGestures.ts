import { useEffect, useMemo, useRef } from "react";
import type * as Y from "yjs";
import type { CanvasGestures, CanvasPress } from "../canvas/BoardCanvas";
import type { Point } from "../realtime/messages";
import { boundsOf, type Corner } from "./geometry";
import {
  areaGesture,
  moveGesture,
  resizeGesture,
  rotateGesture,
  spacingGesture,
  type AreaDraft,
  type Gesture,
} from "./gestures";
import {
  ancestors,
  enterGroup,
  selectionTarget,
  topmost,
  withDescendants,
} from "./groups";
import { GUIDE_SNAP_PX, type Guide } from "./guides";
import type { PlaceableType } from "./objectTypes";
import { GROUP_TYPE, readScene, type SceneObject } from "./sceneObjects";
import {
  FRAME_TYPE,
  frameResizeGesture,
  placeInFrames,
  scaledLeaves,
} from "./frames";
import { drawTool, toolById, type DrawToolId, type ToolId } from "./tools";
import {
  drawGesture,
  eraseGesture,
  laserGesture,
  type InkDraft,
} from "./drawGestures";
import { brushWidth, type DrawSettings } from "./drawSettings";
import { projectOnto, routeOf } from "./connectors";
import { addLabel, boardPoints, setPoints } from "./lineEdits";
import { lineResizeGesture } from "./tables";
import {
  drawLineGesture,
  endGesture,
  labelGesture,
  pointGesture,
  type ConnectHint,
  type LineGestureContext,
} from "./lineGestures";
import type { NodeDrop } from "./mindmapData";
import { nodeDragGesture } from "./mindmapGesture";
import type { NodeDragState } from "./MindmapView";
import { canReactTo } from "./reactions";
import { reactionGesture } from "./reactionGesture";
import type { ReactionDraft } from "./ReactionView";

/** Что сцена даёт жестам. Значения читаются в момент жеста — всегда свежие. */
export interface SceneControls {
  objects: Y.Map<unknown>;
  scene: readonly SceneObject[];
  selection: readonly string[];
  tool: ToolId;
  gridStep: number;
  /** Масштаб вида: расстояние прилипания к соседям задано в экранных px (CVS-16). */
  zoom: number;
  /** Кто правит — для отметки «изменил» (CVS-22). */
  actor: string;
  select: (ids: string[]) => void;
  setTool: (tool: ToolId) => void;
  setDraft: (draft: AreaDraft | null) => void;
  setGuides: (guides: Guide[]) => void;
  /** Ставит объект и возвращает его (CVS-09). */
  create: (type: PlaceableType, at: Point) => SceneObject | null;
  /** STK-05: новый стикер из стопки центром в точке; возвращает его. */
  pull: (stack: SceneObject, at: Point) => SceneObject | null;
  openMenu: (
    menu: { kind: "object" } | { kind: "canvas"; board: Point },
    at: Point,
  ) => void;
  editText: (id: string) => void;
  /** CVS-26: точки привязки объекта под концом линии, пока его тянут. */
  setHint: (hint: ConnectHint) => void;
  /** CON-03: выбрать подпись линии (её оформление — в панели выделения). */
  pickLabel: (lineId: string, labelId: string) => void;
  /** CON-03: открыть подпись линии для ввода текста. */
  editLabel: (lineId: string, labelId: string) => void;
  /** T6.5: перо, маркер и режим «стилус сразу рисует» (DRW-01, DRW-02, MOB-05). */
  drawSettings: DrawSettings;
  /** DRW-01: штрих, который рисуют сейчас (до отпускания). */
  setInk: (ink: InkDraft | null) => void;
  /** DRW-03: стереть штрихи — в корзину. */
  erase: (ids: string[]) => void;
  /** DRW-05: свой след лазера. */
  laser: { begin: (at: Point) => void; add: (at: Point) => void };
  /** TBL-02…TBL-04: выделить ячейку таблицы (`extend` — до неё от прежней, Shift). */
  selectCell: (table: string, cell: string, extend: boolean) => void;
  /** TBL-04: открыть ячейку таблицы для ввода текста. */
  editCell: (table: string, cell: string) => void;
  /** KBN-03: выбрать столбец канбана (действия со столбцом — в панели выделения). */
  selectColumn: (kanban: string, column: string) => void;
  /** KBN-03: открыть название столбца канбана для правки. */
  editColumn: (kanban: string, column: string) => void;
  /** MAP-02: выбрать узел интеллект-карты (действия с узлом — в панели выделения). */
  selectNode: (mindmap: string, node: string) => void;
  /** MAP-02: открыть название узла для правки. */
  editNode: (mindmap: string, node: string) => void;
  /** MAP-03: свернуть или развернуть ветку узла. */
  toggleNode: (mindmap: string, node: string) => void;
  /** MAP-02: перетаскиваемый узел и цель под указателем; `null` — не тащат. */
  dragNode: (drag: (NodeDragState & { mindmap: string }) | null) => void;
  /** MAP-02: переставить узел на цель. */
  dropNode: (mindmap: string, node: string, drop: NodeDrop) => void;
  /** CMT-01: начать ветку комментария у объекта (`null` — в точке холста). */
  comment: (object: SceneObject | null, at: Point) => void;
  /** RCT-04: изображение, которое ставит инструмент Reaction. */
  reactionImage: string;
  /** RCT-03: реакция, которую растят удержанием; `null` — её нет. */
  showReaction: (draft: ReactionDraft | null) => void;
  /** RCT-01: поставить реакцию центром в точке на объект. */
  react: (target: SceneObject, center: Point, size: number) => void;
  /** FLP-02: перевернуть флип-карточку. */
  flip: (id: string) => void;
  /** DICE-02: бросить кубик. */
  roll: (id: string) => void;
}

function hit(target: EventTarget | null): {
  objectId: string | null;
  handle: string | null;
  label: string | null;
  cell: string | null;
  column: string | null;
  node: string | null;
  toggle: string | null;
  flip: boolean;
} {
  if (!(target instanceof Element)) {
    return {
      objectId: null,
      handle: null,
      label: null,
      cell: null,
      column: null,
      node: null,
      toggle: null,
      flip: false,
    };
  }
  return {
    flip: target.closest("[data-flip-toggle]") !== null,
    node: target.closest("[data-node]")?.getAttribute("data-node") ?? null,
    toggle:
      target.closest("[data-node-toggle]")?.getAttribute("data-node-toggle") ??
      null,
    cell: target.closest("[data-cell]")?.getAttribute("data-cell") ?? null,
    column:
      target
        .closest("[data-column-title]")
        ?.getAttribute("data-column-title") ?? null,
    objectId:
      target.closest("[data-object-id]")?.getAttribute("data-object-id") ??
      null,
    handle:
      target.closest("[data-handle]")?.getAttribute("data-handle") ?? null,
    label:
      target.closest("[data-label-id]")?.getAttribute("data-label-id") ?? null,
  };
}

/**
 * RCT-01: объект для реакции под указателем; нажатие на реакцию ставит новую на её
 * объект. Линия, группа и пустое место — `null`.
 */
function reactionTarget(
  scene: readonly SceneObject[],
  leafId: string | null,
): SceneObject | null {
  const leaf = scene.find((o) => o.id === leafId);
  const target =
    leaf?.reaction != null || leaf?.type === "reaction"
      ? scene.find((o) => o.id === leaf.parent)
      : leaf;
  return target !== undefined && canReactTo(target) ? target : null;
}

/** Одна выделенная незаблокированная линия — её точки и подписи правят маркерами. */
function editableLine(selected: readonly SceneObject[]): SceneObject | null {
  const [only] = selected;
  return selected.length === 1 && only?.type === "line" && !only.locked
    ? only
    : null;
}

/**
 * Маркер границы столбца или строки таблицы (TBL-01): `col:<id>` / `row:<id>`; другой
 * маркер — `null`.
 */
function tableHandle(
  handle: string | null,
): { axis: "column" | "row"; id: string } | null {
  if (handle?.startsWith("col:"))
    return { axis: "column", id: handle.slice(4) };
  if (handle?.startsWith("row:")) return { axis: "row", id: handle.slice(4) };
  return null;
}

/** Номер в имени маркера линии: `line-point-2` → 2. */
function handleIndex(handle: string): number {
  return Number(handle.slice(handle.lastIndexOf("-") + 1));
}

/**
 * Маркеры выделенной линии (T6.4): концы (CVS-26, CON-05), точки изгиба и середины
 * участков — новая точка изгиба (CON-01).
 */
function lineHandleGesture(
  ctx: LineGestureContext,
  line: SceneObject,
  handle: string,
): Gesture | null {
  if (handle === "line-start") return endGesture(ctx, line, "start");
  if (handle === "line-end") return endGesture(ctx, line, "end");
  if (handle.startsWith("line-point-")) {
    return pointGesture(ctx, line, handleIndex(handle), false);
  }
  if (handle.startsWith("line-add-")) {
    return pointGesture(ctx, line, handleIndex(handle), true);
  }
  return null;
}

/**
 * Объекты не из групп: их выделяют рамка и лассо (группа — целиком, объект во фрейме —
 * сам по себе, FRM-01).
 */
function roots(scene: readonly SceneObject[]): SceneObject[] {
  const groups = new Set(
    scene.filter((o) => o.type === GROUP_TYPE).map((o) => o.id),
  );
  return scene.filter((o) => o.parent === null || !groups.has(o.parent));
}

/** Соседи перемещаемых для направляющих: всё, кроме них самих, вложенных и их групп. */
function neighborsOf(
  scene: readonly SceneObject[],
  moving: readonly SceneObject[],
) {
  const related = new Set(
    withDescendants(
      scene,
      moving.map((o) => o.id),
    ).map((o) => o.id),
  );
  for (const object of moving) {
    for (const a of ancestors(scene, object.id)) related.add(a.id);
  }
  return scene
    .filter((o) => !related.has(o.id))
    .flatMap((o) => boundsOf([o]) ?? []);
}

/**
 * BUG-016 (TXT-02, UI-04): область касания углового маркера — 44×44 и закрывает флажок
 * списка дел у края выделенного блока. Нажатие на маркер без движения размер не меняет —
 * оно достаётся флажку под маркером.
 */
function checkUnder(press: CanvasPress): void {
  const canvas =
    press.target instanceof Element
      ? press.target.closest(".board-canvas")
      : null;
  if (canvas === null) return;
  const origin = canvas.getBoundingClientRect();
  const x = origin.left + press.screen.x;
  const y = origin.top + press.screen.y;
  const boxes = canvas.querySelectorAll<HTMLInputElement>(
    '.scene-object input[type="checkbox"]',
  );
  const checkbox = [...boxes].find((box) => {
    const rect = box.getBoundingClientRect();
    return (
      rect.width > 0 &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  });
  checkbox?.click();
}

/** Жест, который ничего не меняет: заблокированный объект не двигается (CVS-19). */
function still(click?: () => void): Gesture {
  const noop = () => undefined;
  return { move: noop, end: noop, cancel: noop, ...(click && { click }) };
}

/**
 * Жесты инструментов на холсте (контракт инструмента, ARCHITECTURE.md, раздел 4):
 * - CVS-09: инструмент создания ставит объект в точку нажатия и сразу даёт его подвинуть;
 * - CVS-10: щелчок выделяет (Shift — добавляет/убирает), Shift+перетаскивание по пустому
 *   месту — рамка, инструмент Lasso — область произвольной формы;
 * - CVS-12, CVS-14: перетаскивание объекта, маркеров размера и поворота;
 * - CVS-15: маркеры промежутка распределяют выделенное с равным шагом;
 * - CVS-16: при перемещении — прилипание и направляющие к соседям;
 * - CVS-17: щелчок по объекту группы выделяет группу, двойной — объект внутри;
 * - CVS-19: заблокированный объект выделяется, но не двигается;
 * - CVS-23: контекстное меню объекта и пустого места;
 * - MOB-03: касание пальцем по невыделенному объекту двигает вид; долгое нажатие выделяет
 *   объект (и даёт его тянуть) или начинает рамку на пустом месте;
 * - STK-05: перетаскивание невыделенной стопки (и пальцем) вытягивает из неё новый
 *   стикер, щелчок выделяет стопку, выделенную стопку тянут как обычный объект;
 * - T6.4: инструмент Line рисует линию протяжкой (CON-01); у выделенной линии тянут концы
 *   (привязка к объекту, Alt — без неё, CVS-26; Shift — любой угол, CON-05), точки изгиба
 *   и подписи вдоль линии (CON-03); двойной щелчок по точке удаляет её (CON-06), по линии —
 *   добавляет подпись;
 * - T6.5: перо и маркер рисуют штрих (DRW-01, Shift — прямой, DRW-04), ластик стирает
 *   незаблокированные штрихи (DRW-03), лазер оставляет временный след (DRW-05); при
 *   включённом режиме «стилус сразу рисует» стилус с инструментом Select рисует пером
 *   (MOB-05), а пальцы двигают вид и выделяют;
 * - T6.6: перемещённый, поставленный или нарисованный объект попадает во фрейм под своим
 *   центром или выходит из него (FRM-01); угол одного фрейма меняет его размер без сдвига
 *   содержимого, с фиксированными пропорциями — по их соотношению (FRM-03);
 * - T6.7: щелчок по ячейке таблицы выделяет таблицу и ячейку, Shift+щелчок по ячейке
 *   выделенной таблицы — диапазон, двойной щелчок открывает ячейку для ввода (TBL-02…
 *   TBL-04); маркеры границ выделенной таблицы меняют ширину столбца и высоту строки
 *   (TBL-01); объект попадает в ячейку под своим центром (TBL-05);
 * - T6.8: щелчок по заголовку столбца канбана выделяет канбан и выбирает столбец, двойной
 *   щелчок открывает название столбца для правки (KBN-03); карточка попадает в столбец под
 *   своим центром и встаёт в нём по порядку (KBN-02);
 * - T6.9: щелчок по узлу интеллект-карты выделяет карту и выбирает узел, двойной щелчок
 *   открывает название узла (MAP-02); узел выделенной карты перетаскивается на другой
 *   узел (MAP-02); кнопка у узла сворачивает и разворачивает его ветку (MAP-03);
 * - T6.10: инструмент Comment начинает ветку комментария у объекта под указателем или в
 *   точке холста (CMT-01);
 * - T6.11: инструмент Reaction ставит реакцию на объект под указателем, удержание её
 *   растит (RCT-01, RCT-03); кнопка в углу флип-карточки переворачивает её (FLP-02);
 *   двойной щелчок по кубику бросает его (DICE-02).
 */
export function useSceneGestures(controls: SceneControls): CanvasGestures {
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  });

  return useMemo<CanvasGestures>(() => {
    const selectedObjects = (ids: readonly string[]) =>
      topmost(latest.current.scene, ids);

    /** FRM-01: объекты после жеста — во фрейм под ними или из фрейма. */
    const settle = (ids: readonly string[]) => {
      const c = latest.current;
      placeInFrames(c.objects, readScene(c.objects), ids, c.actor);
    };

    const move = (
      objects: readonly SceneObject[],
      press: CanvasPress,
    ): Gesture => {
      const c = latest.current;
      // RCT-01: реакция держится на своём объекте — её не тащат, она едет с объектом.
      const targets = objects.filter(
        (o) => !o.locked && o.reaction === null && o.type !== "reaction",
      );
      if (targets.length === 0) return still();
      const gesture = moveGesture(c.objects, targets, press.board, {
        gridStep: c.gridStep,
        neighbors: neighborsOf(c.scene, targets),
        threshold: GUIDE_SNAP_PX / c.zoom,
        onGuides: c.setGuides,
        actor: c.actor,
      });
      return {
        ...gesture,
        end: (pointer) => {
          gesture.end(pointer);
          settle(targets.map((o) => o.id));
        },
      };
    };

    /** STK-05: стикер появляется при первом движении и сразу едет за указателем. */
    const pull = (stack: SceneObject, press: CanvasPress): Gesture => {
      let inner: Gesture | null = null;
      let pulled: SceneObject | null = null;
      const begin = (): Gesture => {
        if (inner === null) {
          pulled = latest.current.pull(stack, press.board);
          inner = pulled === null ? still() : move([pulled], press);
        }
        return inner;
      };
      return {
        autoscroll: true,
        move: (pointer) => {
          begin().move(pointer);
        },
        end: (pointer) => {
          begin().end(pointer);
          if (pulled !== null) latest.current.select([pulled.id]);
        },
        cancel: () => {
          inner?.cancel();
        },
        click: () => {
          latest.current.select([stack.id]);
        },
      };
    };

    const lineContext = (): LineGestureContext => {
      const c = latest.current;
      return {
        objects: c.objects,
        scene: c.scene,
        zoom: c.zoom,
        actor: c.actor,
        setHint: c.setHint,
        select: c.select,
      };
    };

    /** Инструмент рисования этого нажатия: выбранный или перо стилуса (MOB-05). */
    const drawingWith = (press: CanvasPress): DrawToolId | null => {
      const c = latest.current;
      const chosen = drawTool(c.tool);
      if (chosen !== null) return chosen;
      const stylus = press.pointerType === "pen" && c.drawSettings.stylusDraws;
      return stylus && c.tool === "select" ? "pen" : null;
    };

    const draw = (kind: DrawToolId, press: CanvasPress): Gesture => {
      const c = latest.current;
      if (kind === "eraser") {
        return eraseGesture(c.scene, press, { zoom: c.zoom, erase: c.erase });
      }
      if (kind === "laser") return laserGesture(press, c.laser);
      const brush = c.drawSettings[kind];
      return drawGesture(
        c.objects,
        press,
        { brush: kind, color: brush.color, width: brushWidth(brush) },
        {
          zoom: c.zoom,
          actor: c.actor,
          onDraft: c.setInk,
          onCommit: (id) => {
            settle([id]);
          },
        },
      );
    };

    const area = (kind: AreaDraft["kind"], press: CanvasPress) => {
      const c = latest.current;
      const base = press.shiftKey ? [...c.selection] : [];
      return areaGesture(
        kind,
        roots(c.scene),
        press.board,
        c.setDraft,
        (ids) => {
          latest.current.select([...new Set([...base, ...ids])]);
          if (kind === "lasso") latest.current.setTool("select");
        },
      );
    };

    return {
      start(press, longPress) {
        const c = latest.current;
        const tool = toolById(c.tool);
        const {
          objectId: leafId,
          handle,
          label,
          cell,
          column,
          node,
          toggle,
          flip,
        } = hit(press.target);

        const drawing = drawingWith(press);
        if (drawing !== null) return draw(drawing, press);
        // CON-01: инструмент Line рисует линию протяжкой.
        if (tool.kind === "create" && tool.id === "line") {
          c.setTool("select");
          return drawLineGesture(lineContext(), press);
        }
        if (tool.kind === "create") {
          const created = c.create(tool.id, press.board);
          c.setTool("select");
          if (created === null) return null;
          // Поставленный щелчком объект сразу открывается для ввода текста.
          return {
            ...move([created], press),
            click: () => {
              latest.current.editText(created.id);
            },
          };
        }
        if (tool.kind === "lasso") return area("lasso", press);
        // CMT-01: инструмент Comment — ветка у объекта под указателем или в точке.
        if (tool.kind === "comment") {
          c.setTool("select");
          c.comment(c.scene.find((o) => o.id === leafId) ?? null, press.board);
          return still();
        }
        // RCT-01, RCT-03: реакция на объект под указателем (на реакции — на её объект).
        if (tool.kind === "react") {
          const target = reactionTarget(c.scene, leafId);
          if (target === null) return still();
          return reactionGesture(press.board, c.reactionImage, {
            show: c.showReaction,
            place: (center, size) => {
              latest.current.react(target, center, size);
            },
          });
        }

        const selected = selectedObjects(c.selection);
        // TBL-01: граница столбца или строки одной выделенной таблицы.
        const border = tableHandle(handle);
        if (border !== null) {
          const [table] = selected;
          if (selected.length !== 1 || table?.table == null || table.locked) {
            return still();
          }
          return lineResizeGesture(
            c.objects,
            table,
            border.axis,
            border.id,
            press.board,
            c.actor,
          );
        }
        const line = editableLine(selected);
        if (line !== null && handle?.startsWith("line-")) {
          return lineHandleGesture(lineContext(), line, handle);
        }
        if (line !== null && label !== null && leafId === line.id) {
          return labelGesture(lineContext(), line, label, (id) => {
            latest.current.pickLabel(line.id, id);
          });
        }
        if (handle !== null && selected.length > 0) {
          if (selected.some((o) => o.locked)) return still();
          if (handle === "rotate") {
            return rotateGesture(c.objects, selected, press.board, c.actor);
          }
          if (handle === "spacing-x" || handle === "spacing-y") {
            const axis = handle === "spacing-x" ? "x" : "y";
            return spacingGesture(
              c.objects,
              selected,
              axis,
              press.board,
              c.actor,
            );
          }
          const [only] = selected;
          const corner = handle as Corner;
          const resize =
            selected.length === 1 && only?.type === FRAME_TYPE
              ? frameResizeGesture(
                  c.objects,
                  only,
                  readScene(c.objects).filter((o) => o.parent === only.id),
                  corner,
                  c.actor,
                )
              : resizeGesture(
                  c.objects,
                  selected,
                  scaledLeaves(
                    c.scene,
                    withDescendants(
                      c.scene,
                      selected.map((o) => o.id),
                    ),
                  ),
                  corner,
                  c.actor,
                );
          return {
            ...resize,
            click: () => {
              checkUnder(press);
            },
          };
        }
        if (leafId !== null) {
          const objectId = selectionTarget(c.scene, leafId, c.selection);
          const isSelected = c.selection.includes(objectId);
          const stack = c.scene.find((o) => o.id === objectId);
          if (stack?.type === "stack" && !isSelected && !press.shiftKey) {
            return pull(stack, press);
          }
          // MOB-03: короткое движение пальцем двигает вид, а не объект.
          if (press.pointerType === "touch" && !longPress && !isSelected) {
            return null;
          }
          // TBL-02…TBL-04: щелчок по ячейке выделяет таблицу и ячейку; Shift+щелчок по
          // ячейке выделенной таблицы — диапазон ячеек, а не снятие выделения.
          const cellOf = objectId === leafId ? cell : null;
          if (cellOf !== null && (isSelected || !press.shiftKey)) {
            const extend = press.shiftKey;
            const ids = isSelected ? [...c.selection] : [objectId];
            c.select(ids);
            return {
              ...move(selectedObjects(ids), press),
              click: () => {
                latest.current.selectCell(objectId, cellOf, extend);
              },
            };
          }
          // FLP-02: кнопка в углу флип-карточки переворачивает её.
          if (flip) {
            return still(() => {
              latest.current.flip(leafId);
            });
          }
          // MAP-03: кнопка у узла сворачивает и разворачивает его ветку.
          if (toggle !== null) {
            return still(() => {
              latest.current.toggleNode(leafId, toggle);
            });
          }
          // MAP-02: щелчок по узлу выбирает узел; узел выделенной карты перетаскивается.
          const nodeOf = objectId === leafId ? node : null;
          if (nodeOf !== null && !press.shiftKey) {
            const map = c.scene.find((o) => o.id === objectId);
            const draggable =
              isSelected &&
              c.selection.length === 1 &&
              map?.mindmap != null &&
              !map.locked &&
              nodeOf !== map.mindmap.root;
            if (draggable) {
              return nodeDragGesture(
                {
                  show: (drag) => {
                    latest.current.dragNode(drag);
                  },
                  drop: (id, dragged, target) => {
                    latest.current.dropNode(id, dragged, target);
                  },
                  select: (id, picked) => {
                    latest.current.selectNode(id, picked);
                  },
                },
                map,
                nodeOf,
                press.board,
              );
            }
            const ids = isSelected ? [...c.selection] : [objectId];
            c.select(ids);
            return {
              ...move(selectedObjects(ids), press),
              click: () => {
                latest.current.selectNode(objectId, nodeOf);
              },
            };
          }
          // KBN-03: щелчок по заголовку столбца выбирает столбец.
          const columnOf = objectId === leafId ? column : null;
          if (columnOf !== null && !press.shiftKey) {
            const ids = isSelected ? [...c.selection] : [objectId];
            c.select(ids);
            return {
              ...move(selectedObjects(ids), press),
              click: () => {
                latest.current.selectColumn(objectId, columnOf);
              },
            };
          }
          const ids = isSelected
            ? [...c.selection]
            : press.shiftKey
              ? [...c.selection, objectId]
              : [objectId];
          c.select(ids);
          const moving = move(selectedObjects(ids), press);
          if (!(press.shiftKey && isSelected)) return moving;
          // Shift+щелчок по выделенному убирает его из выделения, Shift+перетаскивание —
          // двигает выделенное по оси.
          return {
            ...moving,
            click: () => {
              const { selection, select } = latest.current;
              select(selection.filter((id) => id !== objectId));
            },
          };
        }
        if (press.shiftKey || longPress) return area("marquee", press);
        return null;
      },

      tap(press) {
        const c = latest.current;
        const {
          objectId: leafId,
          cell,
          column,
          node,
          toggle,
          flip,
        } = hit(press.target);
        // MAP-03: касание кнопки у узла сворачивает и разворачивает ветку.
        if (leafId !== null && toggle !== null) {
          c.toggleNode(leafId, toggle);
          return;
        }
        // FLP-02: касание кнопки флип-карточки переворачивает её.
        if (leafId !== null && flip) {
          c.flip(leafId);
          return;
        }
        if (leafId !== null) {
          const objectId = selectionTarget(c.scene, leafId, c.selection);
          c.select([objectId]);
          if (node !== null && objectId === leafId) {
            c.selectNode(objectId, node);
          }
          if (cell !== null && objectId === leafId) {
            c.selectCell(objectId, cell, false);
          }
          if (column !== null && objectId === leafId) {
            c.selectColumn(objectId, column);
          }
        } else if (!press.shiftKey) c.select([]);
      },

      contextMenu(press) {
        const c = latest.current;
        const { objectId: leafId } = hit(press.target);
        if (leafId !== null) {
          const objectId = selectionTarget(c.scene, leafId, c.selection);
          if (!c.selection.includes(objectId)) c.select([objectId]);
          c.openMenu({ kind: "object" }, press.screen);
        } else {
          c.openMenu({ kind: "canvas", board: press.board }, press.screen);
        }
      },

      doubleClick(press) {
        const c = latest.current;
        // Двойное касание пером рисует две точки, а не открывает объект.
        if (drawingWith(press) !== null) return;
        const {
          objectId: leafId,
          handle,
          label,
          cell,
          column,
          node,
          toggle,
          flip,
        } = hit(press.target);
        // MAP-03, FLP-02: двойной щелчок по кнопке — два переключения, не правка.
        if (toggle !== null || flip) return;
        // CON-06: двойной щелчок по точке изгиба удаляет её.
        const line = editableLine(selectedObjects(c.selection));
        if (line !== null && handle?.startsWith("line-point-")) {
          const points = boardPoints(line);
          points.splice(handleIndex(handle), 1);
          setPoints(c.objects, line, points, c.actor);
          return;
        }
        if (leafId === null) return;
        const inner = enterGroup(c.scene, leafId, c.selection);
        if (inner !== null) {
          c.select([inner]);
          return;
        }
        const leaf = c.scene.find((o) => o.id === leafId);
        // TBL-04: двойной щелчок по ячейке — ввод текста в ней.
        if (leaf?.table != null && cell !== null) {
          c.editCell(leaf.id, cell);
          return;
        }
        // KBN-03: двойной щелчок по заголовку столбца — правка названия.
        if (leaf?.kanban != null && column !== null) {
          c.editColumn(leaf.id, column);
          return;
        }
        // MAP-02: двойной щелчок по узлу — правка названия.
        if (leaf?.mindmap != null && node !== null) {
          c.editNode(leaf.id, node);
          return;
        }
        // DICE-02: двойной щелчок по кубику — бросок.
        if (leaf?.dice != null) {
          c.roll(leaf.id);
          return;
        }

        if (leaf?.type === "line" && leaf.line !== null && !leaf.locked) {
          // CON-03: двойной щелчок по подписи — правка, по линии — новая подпись.
          c.select([leaf.id]);
          const labelId =
            label ??
            addLabel(
              c.objects,
              leaf.id,
              projectOnto(routeOf(leaf.line), press.board),
              c.actor,
            );
          c.editLabel(leaf.id, labelId);
          return;
        }
        c.editText(leafId);
      },
    };
  }, []);
}
