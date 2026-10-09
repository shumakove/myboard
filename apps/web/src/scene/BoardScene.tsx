import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import { BoardCanvas, type CameraUpdate } from "../canvas/BoardCanvas";
import { focusOn, screenToBoard, type Size } from "../canvas/camera";
import type { WheelMode } from "../canvas/wheel";
import type { BoardDocument } from "../realtime/boardDocument";
import type { CameraView, Point } from "../realtime/messages";
import { ObjectLinkDialog } from "../sharing/ObjectLinkDialog";
import { isDark, useBoardSettings } from "./boardSettings";
import { BoardSearch } from "./BoardSearch";
import { loadClip, type Clip } from "./clipboard";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { AreaDraft } from "./gestures";
import { topmost } from "./groups";
import type { Guide } from "./guides";
import { ObjectPicker } from "../richtext/ObjectPicker";
import { RichTextEditor } from "../richtext/RichTextEditor";
import { objectLabel } from "./objectLabel";
import { objectStyle } from "./objectStyle";
import {
  GROUP_TYPE,
  isRichText,
  typeSpec,
  type ObjectType,
} from "./objectTypes";
import {
  AreaOverlay,
  GuidesOverlay,
  SceneLayer,
  type RichTextHandlers,
} from "./SceneLayer";
import { REDO_KEYS, UNDO_KEYS } from "./keymap";
import { usePinnedTools } from "./pinnedTools";
import { arrangeMenu, boardMenu, objectMenu } from "./sceneMenus";
import {
  createObject,
  objectMap,
  objectText,
  readScene,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";
import { loadTextStyle } from "./textStyle";
import { SelectionBar } from "./SelectionBar";
import { SelectionOverlay } from "./SelectionOverlay";
import { TextEditor } from "./TextEditor";
import { ToolPanel } from "./ToolPanel";
import { Button, FloatingPanel } from "../ui";
import { placement, type ToolId } from "./tools";
import { useSceneCommands } from "./useSceneCommands";
import { useSceneGestures } from "./useSceneGestures";
import { useSceneObjects } from "./useSceneObjects";
import { copyToClipboard, useSceneShortcuts } from "./useSceneShortcuts";
import { useUndoHistory, withUndoSteps } from "./undoHistory";
import "./scene.css";

type Menu =
  | { kind: "object"; at: Point }
  | { kind: "arrange"; at: Point }
  | { kind: "canvas"; at: Point; board: Point; clip: Clip | null };

const MENU_LABELS: Record<Menu["kind"], string> = {
  object: "Object menu",
  arrange: "Arrange menu",
  canvas: "Board menu",
};

/**
 * Сцена доски: объекты документа на холсте, инструменты, выделение и правки (T5.2–T5.4).
 * Объекты общие — правку одного участника видят все (документ Yjs); инструмент,
 * выделение и меню — свои у каждой вкладки.
 *
 * CVS-06 фон и сетка, CVS-09 создание, CVS-10 выделение, CVS-11 фильтр и массовые свойства,
 * CVS-12 перемещение, CVS-13 автопрокрутка, CVS-14 размер и поворот, CVS-15 выравнивание
 * и распределение, CVS-16 направляющие, CVS-17 группы, CVS-18 порядок слоёв, CVS-19
 * блокировка, CVS-20 буфер обмена и дублирование, CVS-21 удаление, CVS-22 автор и даты,
 * CVS-23 контекстное меню, MOB-03 долгое нажатие; T5.4 — CVS-07 отмена и повтор своих
 * правок, CVS-24 закреплённые инструменты, CVS-25 горячие клавиши; T5.5 — CVS-08 поиск
 * по тексту и тегам, SHR-07 ссылка на объект и переход к нему; T6.1 — TXT-01…TXT-08
 * текст и документ с форматированием.
 */
export function BoardScene({
  board,
  camera,
  wheelMode,
  userName,
  stageStyle,
  stageAttributes,
  onMove,
  onPointer,
  onResize,
  worldOverlay,
  stageOverlay,
  focusObject = null,
  boardLink,
}: {
  board: BoardDocument;
  camera: CameraView;
  wheelMode: WheelMode;
  /** Имя участника: автор правок (CVS-22) и удаливший в корзине. */
  userName: string;
  stageStyle?: CSSProperties;
  stageAttributes?: Record<`data-${string}`, string | undefined>;
  onMove: (update: CameraUpdate) => void;
  onPointer: (point: Point | null) => void;
  onResize: (size: Size) => void;
  /** Слой доски поверх объектов (курсоры участников). */
  worldOverlay?: ReactNode;
  /** Поверх холста (миникарта, слежение). */
  stageOverlay?: ReactNode;
  /** SHR-07: объект из ссылки — вид переходит к нему, как только документ загружен. */
  focusObject?: string | null;
  /** SHR-07: действующая ссылка на доску; без неё пункта Copy link to object нет. */
  boardLink?: () => Promise<string>;
}) {
  const { objects } = board;
  const actor = userName;
  const scene = useSceneObjects(objects);
  const settings = useBoardSettings(board.settings);
  const [tool, setTool] = useState<ToolId>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: Y.Text } | null>(
    null,
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<Point | null>(null);
  const { history, canUndo, canRedo } = useUndoHistory(board);
  const { pinned, update: updatePinned } = usePinnedTools();
  const viewport = useRef<Size>({ width: 0, height: 0 });
  const [searching, setSearching] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkMissing, setLinkMissing] = useState(false);
  /** TXT-06: открыт выбор объекта для ссылки документа — куда вернуть выбор. */
  const [picker, setPicker] = useState<{
    done: (id: string | null) => void;
  } | null>(null);

  /** CVS-08, SHR-07: вид — к объекту, объект выделен. `false` — объекта на доске нет. */
  const goTo = useCallback(
    (id: string): boolean => {
      const target = readScene(objects).find((o) => o.id === id);
      if (target === undefined) return false;
      setSelection([id]);
      onMove(() => focusOn(target, viewport.current));
      return true;
    },
    [objects, onMove],
  );

  // SHR-07: переход по ссылке — один раз на объект из ссылки.
  const linkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusObject === null || linkedRef.current === focusObject) return;
    linkedRef.current = focusObject;
    setLinkMissing(!goTo(focusObject));
  }, [focusObject, goTo]);

  // Объект, удалённый другим участником, пропадает из выделения сам.
  const selected = useMemo(
    () => scene.filter((o) => selection.includes(o.id)),
    [scene, selection],
  );
  const selectedIds = useMemo(() => selected.map((o) => o.id), [selected]);
  const editedObject = scene.find((o) => o.id === editing?.id) ?? null;

  const editText = useCallback(
    (id: string) => {
      // CVS-19: текст заблокированного объекта не меняется.
      if (readScene(objects).find((o) => o.id === id)?.locked !== false) return;
      const text = objectText(objects, id);
      setEditing(text === null ? null : { id, text });
    },
    [objects],
  );
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);
  const stopEditing = useCallback(() => {
    setEditing(null);
  }, []);
  const pastePoint = useCallback(
    () => pointer.current ?? { x: camera.x, y: camera.y },
    [camera.x, camera.y],
  );

  const create = useCallback(
    (type: ObjectType, at: Point): SceneObject | null => {
      const id = createObject(
        objects,
        type,
        placement(type, at, settings.gridStep),
        "",
        actor,
        // TXT-05: новый текст — с последним выбранным в этой вкладке размером и цветом.
        type === "text" ? loadTextStyle() : {},
      );
      setSelection([id]);
      return readScene(objects).find((o) => o.id === id) ?? null;
    },
    [objects, settings.gridStep, actor],
  );

  const commands = useSceneCommands({
    board,
    scene,
    selection: selectedIds,
    select: setSelection,
    actor,
    gridStep: settings.gridStep,
    pastePoint,
    onRemoved: stopEditing,
  });
  const { units, editable } = commands;

  const sceneGestures = useSceneGestures({
    objects,
    scene,
    selection,
    tool,
    gridStep: settings.gridStep,
    zoom: camera.zoom,
    actor,
    select: setSelection,
    setTool,
    setDraft,
    setGuides,
    create,
    openMenu: (next, at) => {
      setMenu(
        next.kind === "object"
          ? { kind: "object", at }
          : { ...next, at, clip: loadClip() },
      );
    },
    editText,
  });
  const gestures = useMemo(
    () => withUndoSteps(sceneGestures, history),
    [sceneGestures, history],
  );

  // CVS-07: сеанс правки текста — один шаг отмены.
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editingId === null) return;
    history.begin();
    return () => {
      history.end();
    };
  }, [editingId, history]);

  useSceneShortcuts(commands, {
    onEscape: useCallback(() => {
      setSelection([]);
      setTool("select");
    }, []),
    onTool: setTool,
    history,
  });

  /** CVS-09: инструмент отпустили над холстом — объект встаёт в эту точку. */
  function drop(type: ObjectType, client: Point) {
    const element = canvasRef.current;
    if (element === null) return;
    if (!isOverCanvas(element, client)) return;
    const rect = element.getBoundingClientRect();
    create(
      type,
      screenToBoard(
        { x: client.x - rect.left, y: client.y - rect.top },
        camera,
        { width: rect.width, height: rect.height },
      ),
    );
    setTool("select");
  }

  /** Меню у кнопки панели выделения — в координатах области холста. */
  function openMenuAt(kind: "object" | "arrange", button: HTMLElement) {
    const stage = stageRef.current?.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    setMenu({
      kind,
      at: {
        x: rect.left - (stage?.left ?? 0),
        y: rect.bottom - (stage?.top ?? 0),
      },
    });
  }

  const [single] = units;
  const editSelected =
    units.length === 1 &&
    single !== undefined &&
    !single.locked &&
    typeSpec(single.type) !== undefined
      ? () => {
          editText(single.id);
        }
      : null;

  const label = useCallback((id: string) => objectLabel(scene, id), [scene]);
  const richHandlers: RichTextHandlers = {
    // TXT-02: отметка пункта списка дел прямо на холсте, без редактора.
    onCheck: (id, end, checked) => {
      const text = objectText(objects, id);
      const map = objectMap(objects, id);
      if (text === null || map === null || end >= text.length) return;
      transact(objects, () => {
        text.format(end, 1, { list: checked ? "checked" : "unchecked" });
        touch(map, actor);
      });
    },
    // TXT-06: ссылка документа ведёт к объекту.
    onOpenObject: (id) => {
      goTo(id);
    },
    objectLabel: label,
  };

  /** Своя правка текста: отметка «изменил» и высота блока под содержимое. */
  function onRichEdit(object: SceneObject, height: number) {
    const map = objectMap(objects, object.id);
    if (map === null) return;
    touch(map, actor);
    const current = map.get("height");
    const grow = object.type === "document";
    if (
      typeof current === "number" &&
      (grow ? height > current : Math.abs(height - current) >= 1)
    ) {
      map.set("height", height);
    }
  }

  function menuItems(current: Menu): MenuItem[] {
    switch (current.kind) {
      case "arrange":
        return arrangeMenu(commands);
      case "object":
        return objectMenu(commands, {
          editText: editSelected,
          copyToClipboard: (cut) => {
            copyToClipboard(commands, cut);
          },
          copyLink:
            boardLink !== undefined &&
            single !== undefined &&
            units.length === 1
              ? () => {
                  setLinkFor(single.id);
                }
              : null,
        });
      case "canvas":
        return boardMenu(commands, current.board, current.clip, {
          create,
          selectAll: () => {
            setSelection(
              topmost(
                scene,
                scene.map((o) => o.id),
              ).map((o) => o.id),
            );
          },
        });
    }
  }

  return (
    <div className="board-scene">
      <ToolPanel
        tool={tool}
        pinned={pinned}
        onTool={setTool}
        onPinned={updatePinned}
        onDrop={drop}
      >
        <span role="group" aria-label="Board actions" className="board-actions">
          <Button
            variant="ghost"
            className="tool-button"
            title="Undo your last change (Ctrl+Z, ⌘Z)."
            aria-keyshortcuts={UNDO_KEYS}
            disabled={!canUndo}
            onClick={() => {
              history.undo();
            }}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            className="tool-button"
            title="Redo your undone change (Ctrl+Shift+Z, ⌘⇧Z, Ctrl+Y)."
            aria-keyshortcuts={REDO_KEYS}
            disabled={!canRedo}
            onClick={() => {
              history.redo();
            }}
          >
            Redo
          </Button>
          <Button
            variant="ghost"
            className="tool-button"
            title="Find objects by text or tag."
            aria-pressed={searching}
            onClick={() => {
              setSearching((open) => !open);
            }}
          >
            Search
          </Button>
          <Button
            variant="ghost"
            className="tool-button"
            title="Paste the last copied objects in the center of the view."
            onClick={() => {
              const clip = loadClip();
              if (clip !== null)
                commands.paste(clip, { x: camera.x, y: camera.y });
            }}
          >
            Paste
          </Button>
          <Button
            variant="ghost"
            className="tool-button"
            disabled={commands.unlockAll === null}
            onClick={() => {
              commands.unlockAll?.();
            }}
          >
            Unlock all
          </Button>
        </span>
      </ToolPanel>
      <div
        ref={stageRef}
        className="board-stage"
        style={stageStyle}
        {...stageAttributes}
      >
        <BoardCanvas
          camera={camera}
          wheelMode={wheelMode}
          background={settings.background}
          dotColor={
            isDark(settings.background)
              ? "var(--color-grid-dot-on-dark)"
              : "var(--color-grid-dot)"
          }
          gridStep={settings.gridStep}
          gestures={gestures}
          canvasRef={canvasRef}
          onMove={onMove}
          onPointer={(point) => {
            pointer.current = point;
            onPointer(point);
          }}
          onResize={(size) => {
            viewport.current = size;
            onResize(size);
          }}
        >
          <SceneLayer
            objects={scene}
            selected={new Set(selectedIds)}
            editing={editing?.id ?? null}
            rich={richHandlers}
          />
          {editedObject && editing && isRichText(editedObject.type) && (
            <RichTextEditor
              key={editedObject.id}
              type={editedObject.type}
              text={editing.text}
              style={objectStyle(editedObject)}
              zoom={camera.zoom}
              objectLabel={label}
              onEdit={(height) => {
                onRichEdit(editedObject, height);
              }}
              onDone={stopEditing}
              onPickObject={(done) => {
                setPicker({ done });
              }}
            />
          )}
          {editedObject && editing && !isRichText(editedObject.type) && (
            <TextEditor
              key={editedObject.id}
              object={editedObject}
              text={editing.text}
              onEdit={() => {
                const map = objectMap(objects, editedObject.id);
                if (map !== null) touch(map, actor);
              }}
              onDone={stopEditing}
            />
          )}
          <SelectionOverlay selected={units} />
          <AreaOverlay draft={draft} />
          <GuidesOverlay guides={guides} />
          {worldOverlay}
        </BoardCanvas>
        <SelectionBar
          selected={units}
          onFilter={(type) => {
            setSelection(units.filter((o) => o.type === type).map((o) => o.id));
          }}
          onStyle={commands.setStyle}
          onEditText={editSelected}
          onDelete={commands.remove}
          onLock={commands.lock}
          onUnlock={commands.unlock}
          onGroup={commands.group}
          onUngroup={commands.ungroup}
          onArrange={
            editable.length > 0
              ? (button) => {
                  openMenuAt("arrange", button);
                }
              : null
          }
          onMore={(button) => {
            openMenuAt("object", button);
          }}
        />
        {stageOverlay}
        {searching && (
          <BoardSearch
            scene={scene}
            onGoTo={goTo}
            onClose={() => {
              setSearching(false);
            }}
          />
        )}
        {linkMissing && (
          <FloatingPanel role="status" className="board-notice">
            The linked object is not on this board.
            <Button
              variant="ghost"
              onClick={() => {
                setLinkMissing(false);
              }}
            >
              Dismiss
            </Button>
          </FloatingPanel>
        )}
        {menu && (
          <ContextMenu
            label={MENU_LABELS[menu.kind]}
            at={menu.at}
            items={menuItems(menu)}
            onClose={closeMenu}
          />
        )}
      </div>
      {picker !== null && (
        <ObjectPicker
          objects={scene
            .filter((o) => o.type !== GROUP_TYPE && o.id !== editing?.id)
            .map((o) => ({ id: o.id, label: label(o.id) ?? o.id }))}
          onPick={(id) => {
            setPicker(null);
            picker.done(id);
          }}
          onClose={() => {
            setPicker(null);
            picker.done(null);
          }}
        />
      )}
      {linkFor !== null && boardLink !== undefined && (
        <ObjectLinkDialog
          objectId={linkFor}
          boardLink={boardLink}
          onClose={() => {
            setLinkFor(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Точка окна над самим холстом, а не над панелями поверх него (миникарта, панель
 * выделения): отпускание кнопки инструмента на них объект не ставит.
 */
function isOverCanvas(canvas: HTMLElement, client: Point): boolean {
  const rect = canvas.getBoundingClientRect();
  const inside =
    client.x >= rect.left &&
    client.x <= rect.right &&
    client.y >= rect.top &&
    client.y <= rect.bottom;
  // jsdom не реализует elementFromPoint — там достаточно прямоугольника.
  if (!inside || typeof document.elementFromPoint !== "function") return inside;
  const below = document.elementFromPoint(client.x, client.y);
  return below !== null && canvas.contains(below);
}
