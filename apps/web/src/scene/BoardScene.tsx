import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import { BoardCanvas, type CameraUpdate } from "../canvas/BoardCanvas";
import { centerOn, focusOn, screenToBoard, type Size } from "../canvas/camera";
import type { WheelMode } from "../canvas/wheel";
import { useBoardComments } from "../comments/useBoardComments";
import { moveToTrash, type BoardDocument } from "../realtime/boardDocument";
import type { CameraView, LaserTrail, Point } from "../realtime/messages";
import { ObjectLinkDialog } from "../sharing/ObjectLinkDialog";
import { isDark, useBoardSettings } from "./boardSettings";
import { BoardSearch } from "./BoardSearch";
import { loadClip, type Clip } from "./clipboard";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { AreaDraft } from "./gestures";
import { topmost } from "./groups";
import type { Guide } from "./guides";
import { useBoardNote } from "../notes/useBoardNote";
import { ObjectPicker } from "../richtext/ObjectPicker";
import { RichTextEditor } from "../richtext/RichTextEditor";
import { objectLabel } from "./objectLabel";
import { objectStyle, sideTextStyle } from "./objectStyle";
import {
  AUTO_FONT_SIZE,
  GROUP_TYPE,
  isRichText,
  TAGGED_TYPES,
  typeSpec,
  type PlaceableType,
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
  writeFields,
  type SceneObject,
} from "./sceneObjects";
import {
  createNextSticky,
  loadStickyColor,
  pullSticky,
  rememberStickyColor,
} from "./stickies";
import { StickyPalette } from "./StickyPalette";
import {
  loadShapeKind,
  newShapeFields,
  rememberShapeKind,
  shapeKind,
} from "./shapes";
import { ShapePalette } from "./ShapePalette";
import { shapeEditorStyle } from "./shapeText";
import { colorCategory, useRecentColors } from "./recentColors";
import { addTag, removeTag } from "./tags";
import { fittedHeight } from "./textHeight";
import { loadTextStyle } from "./textStyle";
import {
  SelectionBar,
  type AuthorToggle,
  type ColorActions,
  type TagActions,
} from "./SelectionBar";
import { SelectionOverlay } from "./SelectionOverlay";
import { TextEditor } from "./TextEditor";
import { LABEL_PLACES } from "./connectors";
import type { LineActions } from "./LineControls";
import {
  addLabel,
  createLine,
  detachFrom,
  detachLine,
  isAttached,
  labelText,
  removeLabel,
  setLabel,
  swapEnds,
} from "./lineEdits";
import {
  DEFAULT_LINE_LENGTH,
  dropEmptyLabel,
  type ConnectHint,
} from "./lineGestures";
import { ConnectOverlay, type LabelState } from "./LineView";
import { labelPlace, labelTextStyle } from "./lineLayout";
import { ToolPanel } from "./ToolPanel";
import { Button, FloatingPanel } from "../ui";
import { drawTool, placement, type ToolId } from "./tools";
import { DrawPanel } from "./DrawPanel";
import { InkOverlay } from "./DrawingView";
import type { InkDraft } from "./drawGestures";
import { useDrawSettings } from "./drawSettings";
import { useLaser } from "./laser";
import { LaserView } from "./LaserView";
import { useSceneCommands } from "./useSceneCommands";
import { adoptContained, placeInFrames, sendToBack } from "./frames";
import { useSceneGestures } from "./useSceneGestures";
import { useSceneObjects } from "./useSceneObjects";
import { copyToClipboard, useSceneShortcuts } from "./useSceneShortcuts";
import { useTextFit } from "./useTextFit";
import { cellEditorStyle } from "./tableStyle";
import { PasteTableChoice } from "./PasteTableChoice";
import { tableActionsFor } from "./tableActions";
import { cellText, clearCells, ownerOf } from "./tableData";
import type { Grid } from "./tableExchange";
import {
  cellAfter,
  createTable,
  editorExit,
  editTable,
  emptyGrid,
  selectedCells,
  type CellSelection,
} from "./tables";
import { NEW_TABLE_SIZE } from "./tableData";
import { useTableKeys } from "./useTableKeys";
import { columnTitle } from "./kanbanData";
import {
  addCard,
  addColumn,
  columnCards,
  createKanban,
  deleteColumn,
  type ColumnFate,
} from "./kanbans";
import { DeleteColumnDialog, type KanbanActions } from "./KanbanControls";
import { columnEditorStyle } from "./kanbans";
import { createMindmap } from "./mindmaps";
import { useMindmapNodes } from "./useMindmapNodes";
import { createDice } from "./dice";
import { createFlipCard, sideText } from "./flipCards";
import { shownSide } from "./flipData";
import { useFlipAndDice } from "./useFlipAndDice";
import { createReaction } from "./reactions";
import { useReactionChoice } from "./reactionChoice";
import { ReactionPalette } from "./ReactionPalette";
import { ReactionDraftView, type ReactionDraft } from "./ReactionView";
import { useUndoHistory, withUndoSteps } from "./undoHistory";
import "./scene.css";

/** Столбец канбана (KBN-03). */
interface KanbanColumn {
  kanban: string;
  column: string;
}

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
 * текст и документ с форматированием; T6.2 — STK-01…STK-05 стикеры и стопка стикеров;
 * T6.3 — SHP-01…SHP-04 наборы фигур, маркеры BPMN, оформление фигуры и недавние цвета;
 * T6.4 — CON-01…CON-07, CVS-26 соединительные линии, их подписи и привязка к объектам;
 * T6.5 — DRW-01…DRW-06 перо, маркер, пресеты толщины, ластик, прямой штрих, лазер и
 * масштаб штриха, MOB-04 отсев ладони (`BoardCanvas`), MOB-05 «стилус сразу рисует»;
 * T6.6 — FRM-01…FRM-05 фреймы: содержимое, оформление, пропорции, скрытие содержимого
 * и выбор блокировки; T6.7 — TBL-01…TBL-07 таблицы: строки, столбцы и их размер,
 * оформление и объединение ячеек, переход стрелками, объекты в ячейках, обмен с внешними
 * электронными таблицами и вставка таблицы стикерами; T6.8 — KBN-01…KBN-03 канбан со
 * столбцами, карточки задач с текстом и тегами, перенос карточек между столбцами,
 * добавление, переименование и удаление столбца с выбором судьбы его карточек; T6.9 —
 * MAP-01…MAP-04 интеллект-карты: узлы, их правка и перестановка, сворачивание веток,
 * вопрос о перекраске дочерних узлов (`useMindmapNodes`); T6.10 — CMT-01…CMT-04
 * комментарии: ветки у объекта или точки, переписка, «решено», непрочитанные, цвет и
 * фильтр по участникам (`useBoardComments`); T6.11 — RCT-01…RCT-04 реакции на объектах
 * (инструмент Reaction, наборы и недавние), FLP-01…FLP-03 флип-карточки и DICE-01…DICE-03
 * кубики (`useFlipAndDice`).
 */
export function BoardScene({
  board,
  boardId,
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
  onLaser,
  loaded = true,
}: {
  board: BoardDocument;
  /** Доска: свои отметки прочитанных комментариев — по ней (CMT-02). */
  boardId: string;
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
  /** DRW-05: свой след лазера — в присутствие для остальных; `null` — следа нет. */
  onLaser?: (trail: LaserTrail | null) => void;
  /** NTE-02: документ сверен с сервером — закреплённая заметка открывается. */
  loaded?: boolean;
}) {
  const { objects } = board;
  const actor = userName;
  const scene = useSceneObjects(objects);
  // FRM-04: скрытое содержимое фреймов не показывается и не выделяется.
  const visible = useMemo(() => scene.filter((o) => !o.hidden), [scene]);
  const settings = useBoardSettings(board.settings);
  const [tool, setTool] = useState<ToolId>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: Y.Text } | null>(
    null,
  );
  /** STK-01: цвет следующего стикера или стопки — выбирается до постановки. */
  const [stickyColor, setStickyColor] = useState(loadStickyColor);
  /** SHP-01, SHP-02: вид следующей фигуры — выбирается до постановки. */
  const [shapeChoice, setShapeChoice] = useState(loadShapeKind);
  /** RCT-04: выбранная реакция и недавние; RCT-03: реакция, которую растят удержанием. */
  const reactions = useReactionChoice();
  const [reactionDraft, setReactionDraft] = useState<ReactionDraft | null>(
    null,
  );
  /** SHP-04: недавние свои цвета по категориям объектов. */
  const recentColors = useRecentColors();
  /** CVS-26: точки привязки под концом линии, пока его тянут. */
  const [hint, setHint] = useState<ConnectHint>(null);
  /** CON-03: выбранная (или открытая для ввода) подпись линии. */
  const [lineLabel, setLineLabel] = useState<LabelState | null>(null);
  /** T6.5: настройки пера и маркера, штрих в работе и свой след лазера. */
  const drawing = useDrawSettings();
  const [ink, setInk] = useState<InkDraft | null>(null);
  const laser = useLaser(onLaser ?? ignoreLaser);
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<Point | null>(null);
  const { history, canUndo, canRedo } = useUndoHistory(board);
  const { pinned, update: updatePinned } = usePinnedTools();
  const viewport = useRef<Size>({ width: 0, height: 0 });
  const [searching, setSearching] = useState(false);
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

  const label = useCallback((id: string) => objectLabel(scene, id), [scene]);
  /** TXT-06, NTE-03: открыт выбор объекта для ссылки — куда вернуть выбор. */
  const [picker, setPicker] = useState<{
    done: (id: string | null) => void;
  } | null>(null);
  /** NTE-01…NTE-03: заметка доски; её панель на месте поиска и комментариев. */
  const note = useBoardNote({
    notes: board.notes,
    loaded,
    objectLabel: label,
    onOpenObject: goTo,
    onPickObject: (done) => {
      setPicker({ done });
    },
  });
  const { close: closeNote } = note;
  /** T6.10: комментарии; их панель, поиск и заметка занимают одно место — открыт один. */
  const comments = useBoardComments({
    comments: board.comments,
    scene: visible,
    boardId,
    self: actor,
    goTo: useCallback(
      (point: Point) => {
        onMove((current) => centerOn(current, point));
      },
      [onMove],
    ),
  });
  const { start: openDraft } = comments;
  const startComment = useCallback(
    (object: SceneObject | null, at: Point) => {
      setSearching(false);
      closeNote();
      openDraft(object, at);
    },
    [openDraft, closeNote],
  );
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkMissing, setLinkMissing] = useState(false);
  /** TBL-02…TBL-04: выделенные ячейки таблицы и ячейка, в которой вводят текст. */
  const [cells, setCells] = useState<CellSelection | null>(null);
  const [cellEdit, setCellEdit] = useState<{
    table: string;
    cell: string;
    text: Y.Text;
  } | null>(null);
  /** TBL-06, TBL-07: внешняя таблица из буфера ждёт выбора, как её вставить. */
  const [pasteGrid, setPasteGrid] = useState<Grid | null>(null);
  /** KBN-03: выбранный столбец канбана, правка его названия и вопрос перед удалением. */
  const [column, setColumn] = useState<KanbanColumn | null>(null);
  const [columnEdit, setColumnEdit] = useState<
    (KanbanColumn & { text: Y.Text }) | null
  >(null);
  const [columnDelete, setColumnDelete] = useState<KanbanColumn | null>(null);

  // SHR-07: переход по ссылке — один раз на объект из ссылки.
  const linkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusObject === null || linkedRef.current === focusObject) return;
    linkedRef.current = focusObject;
    setLinkMissing(!goTo(focusObject));
  }, [focusObject, goTo]);

  // Объект, удалённый другим участником, пропадает из выделения сам.
  const selected = useMemo(
    () => visible.filter((o) => selection.includes(o.id)),
    [visible, selection],
  );
  const selectedIds = useMemo(() => selected.map((o) => o.id), [selected]);
  const editedObject = scene.find((o) => o.id === editing?.id) ?? null;
  // Подпись — только у одной выделенной линии, пока подпись есть.
  const labelLine =
    lineLabel !== null &&
    selected.length === 1 &&
    selected[0]?.id === lineLabel.line
      ? selected[0]
      : null;
  const activeLabel =
    labelLine?.line?.labels.find((l) => l.id === lineLabel?.label) ?? null;
  const labelState = activeLabel === null ? null : lineLabel;

  const editText = useCallback(
    (id: string) => {
      const target = readScene(objects).find((o) => o.id === id);
      // CVS-19: текст заблокированного объекта не меняется; у стопки текста нет.
      if (target?.locked !== false || typeSpec(target.type)?.editable !== true)
        return;
      // FLP-01: у флип-карточки правят текст показанной стороны.
      const text =
        target.flip === null
          ? objectText(objects, id)
          : sideText(objects, id, shownSide(target.flip));
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
  /** Конец правки этого объекта; правку другого (новый стикер по Tab) не трогает. */
  const stopEditingOf = useCallback((id: string) => {
    setEditing((current) => (current?.id === id ? null : current));
  }, []);
  const pastePoint = useCallback(
    () => pointer.current ?? { x: camera.x, y: camera.y },
    [camera.x, camera.y],
  );

  const create = useCallback(
    (
      type: PlaceableType,
      at: Point,
      choice: { fill?: string; shape?: string } = {},
    ): SceneObject | null => {
      // CON-01: линия, поставленная без протяжки, — горизонтальная, центром в точке.
      if (type === "line") {
        const half = DEFAULT_LINE_LENGTH / 2;
        const id = createLine(
          objects,
          { point: { x: at.x - half, y: at.y } },
          { point: { x: at.x + half, y: at.y } },
          actor,
        );
        setSelection([id]);
        return readScene(objects).find((o) => o.id === id) ?? null;
      }
      // MAP-01: новая интеллект-карта с корнем и детьми; попадает во фрейм (FRM-01).
      if (type === "mindmap") {
        let id = "";
        board.doc.transact(() => {
          id = createMindmap(
            objects,
            placement(type, at, settings.gridStep),
            actor,
          );
          placeInFrames(objects, readScene(objects), [id], actor);
        });
        setSelection([id]);
        return readScene(objects).find((o) => o.id === id) ?? null;
      }
      // FLP-01, DICE-01: флип-карточка и кубик со своими полями; попадают во фрейм.
      if (type === "flipcard" || type === "dice") {
        let id = "";
        board.doc.transact(() => {
          const corner = placement(type, at, settings.gridStep);
          id =
            type === "dice"
              ? createDice(objects, corner, actor)
              : createFlipCard(objects, corner, actor);
          placeInFrames(objects, readScene(objects), [id], actor);
        });
        setSelection([id]);
        return readScene(objects).find((o) => o.id === id) ?? null;
      }
      // KBN-01: новый канбан со столбцами; попадает во фрейм под собой (FRM-01).
      if (type === "kanban") {
        let id = "";
        board.doc.transact(() => {
          id = createKanban(
            objects,
            placement(type, at, settings.gridStep),
            actor,
          );
          placeInFrames(objects, readScene(objects), [id], actor);
        });
        setSelection([id]);
        return readScene(objects).find((o) => o.id === id) ?? null;
      }
      // TBL-01: новая таблица 3×3; попадает во фрейм под собой (FRM-01).
      if (type === "table") {
        let id = "";
        board.doc.transact(() => {
          id = createTable(
            objects,
            placement(type, at, settings.gridStep),
            emptyGrid(NEW_TABLE_SIZE, NEW_TABLE_SIZE),
            actor,
          );
          placeInFrames(objects, readScene(objects), [id], actor);
        });
        setSelection([id]);
        return readScene(objects).find((o) => o.id === id) ?? null;
      }
      // SHP-01, SHP-02: фигура — выбранного вида, с его размером и оформлением.
      const shape =
        type === "shape"
          ? newShapeFields(shapeKind(choice.shape ?? shapeChoice))
          : null;
      let id = "";
      board.doc.transact(() => {
        id = createObject(
          objects,
          type,
          placement(type, at, settings.gridStep, shape ?? undefined),
          "",
          actor,
          // TXT-05: новый текст — с последним выбранным в этой вкладке размером и цветом;
          // STK-01, STK-05: стикер и стопка — выбранного до постановки цвета.
          type === "text"
            ? loadTextStyle()
            : type === "sticky" || type === "stack"
              ? { fill: choice.fill ?? stickyColor }
              : (shape?.style ?? {}),
          shape ?? undefined,
        );
        // FRM-01: новый фрейм — под объектами и забирает лежащие в нём; новый объект
        // внутри фрейма попадает в него.
        if (type === "frame") {
          sendToBack(objects, readScene(objects), id);
          adoptContained(objects, readScene(objects), id, actor);
        } else {
          placeInFrames(objects, readScene(objects), [id], actor);
        }
      });
      setSelection([id]);
      return readScene(objects).find((o) => o.id === id) ?? null;
    },
    [board, objects, settings.gridStep, actor, stickyColor, shapeChoice],
  );

  /** STK-05: стикер из стопки. */
  const pull = useCallback(
    (stack: SceneObject, at: Point): SceneObject | null => {
      const id = pullSticky(objects, stack, at, actor);
      return readScene(objects).find((o) => o.id === id) ?? null;
    },
    [objects, actor],
  );

  /** DRW-03: стёртые штрихи — в корзину; привязанные к ним линии остаются на месте. */
  const erase = useCallback(
    (ids: string[]) => {
      board.doc.transact(() => {
        detachFrom(objects, readScene(objects), new Set(ids), actor);
        moveToTrash(board, ids, actor);
      });
      setSelection((current) => current.filter((id) => !ids.includes(id)));
    },
    [board, objects, actor],
  );

  /** Таблица для ячеек: есть на доске, не заблокирована (CVS-19). */
  const tableById = useCallback(
    (id: string): SceneObject | null => {
      const target = readScene(objects).find((o) => o.id === id);
      return target?.table != null && !target.locked ? target : null;
    },
    [objects],
  );

  /** TBL-02…TBL-04: выделить ячейку (`extend` — диапазон от прежней, Shift). */
  const selectCell = useCallback(
    (tableId: string, cell: string, extend: boolean) => {
      const table = tableById(tableId);
      const owner = table?.table ? ownerOf(table.table, cell) : null;
      if (owner === null) return;
      setSelection([tableId]);
      setCells((current) =>
        extend && current?.table === tableId
          ? { ...current, focus: owner }
          : { table: tableId, anchor: owner, focus: owner },
      );
    },
    [tableById],
  );

  /** TBL-04: ввод текста в ячейке — обычное поле поверх неё. */
  const editCell = useCallback(
    (tableId: string, cell: string) => {
      const table = tableById(tableId);
      const owner = table?.table ? ownerOf(table.table, cell) : null;
      const map = objectMap(objects, tableId);
      if (owner === null || map === null) return;
      const text = cellText(map, owner);
      setSelection([tableId]);
      setCells({ table: tableId, anchor: owner, focus: owner });
      setCellEdit({ table: tableId, cell: owner, text });
    },
    [objects, tableById],
  );

  /** Канбан для действий со столбцами: есть на доске, не заблокирован (CVS-19). */
  const kanbanById = useCallback(
    (id: string): SceneObject | null => {
      const target = readScene(objects).find((o) => o.id === id);
      return target?.kanban != null && !target.locked ? target : null;
    },
    [objects],
  );

  /** KBN-03: выбрать столбец канбана. */
  const selectColumn = useCallback(
    (kanbanId: string, columnId: string) => {
      if (kanbanById(kanbanId) === null) return;
      setSelection([kanbanId]);
      setColumn({ kanban: kanbanId, column: columnId });
    },
    [kanbanById],
  );

  /** KBN-03: правка названия столбца — обычное поле поверх заголовка. */
  const editColumn = useCallback(
    (kanbanId: string, columnId: string) => {
      const map = objectMap(objects, kanbanId);
      if (kanbanById(kanbanId) === null || map === null) return;
      const text = columnTitle(map, columnId);
      setSelection([kanbanId]);
      setColumn({ kanban: kanbanId, column: columnId });
      setColumnEdit({ kanban: kanbanId, column: columnId, text });
    },
    [objects, kanbanById],
  );

  // T6.9: узлы интеллект-карты — выбор, правка, перестановка, перекраска.
  const mindmap = useMindmapNodes({
    objects,
    scene: visible,
    selection,
    select: setSelection,
    actor,
  });

  const fitText = useTextFit(objects, stageRef, history, actor);
  const commands = useSceneCommands({
    board,
    scene,
    selection: selectedIds,
    select: setSelection,
    actor,
    gridStep: settings.gridStep,
    pastePoint,
    onRemoved: stopEditing,
    onTextLayout: fitText,
  });
  const { units, editable } = commands;
  // T6.11: флип-карточки и кубики в выделении.
  const flipAndDice = useFlipAndDice({ objects, units, actor });
  const { choice: reactionChoice, used: reactionUsed } = reactions;

  const sceneGestures = useSceneGestures({
    objects,
    scene: visible,
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
    pull,
    openMenu: (next, at) => {
      setMenu(
        next.kind === "object"
          ? { kind: "object", at }
          : { ...next, at, clip: loadClip() },
      );
    },
    editText,
    setHint,
    pickLabel: (line, label) => {
      setLineLabel({ line, label, editing: false });
    },
    editLabel: (line, label) => {
      setLineLabel({ line, label, editing: true });
    },
    drawSettings: drawing.settings,
    setInk,
    erase,
    laser,
    selectCell,
    editCell,
    selectColumn,
    editColumn,
    selectNode: mindmap.selectNode,
    editNode: mindmap.editNode,
    toggleNode: mindmap.toggleNode,
    dragNode: mindmap.dragNode,
    dropNode: mindmap.dropNode,
    comment: startComment,
    reactionImage: reactionChoice.current,
    showReaction: setReactionDraft,
    react: (target, center, size) => {
      createReaction(
        objects,
        target,
        center,
        size,
        reactionChoice.current,
        actor,
      );
      reactionUsed(reactionChoice.current);
    },
    flip: flipAndDice.flipOne,
    roll: flipAndDice.rollOne,
  });
  const gestures = useMemo(
    () => withUndoSteps(sceneGestures, history),
    [sceneGestures, history],
  );

  // CVS-07: сеанс правки текста (и подписи линии) — один шаг отмены.
  const editingId =
    editing?.id ??
    (cellEdit !== null ? `${cellEdit.table}#${cellEdit.cell}` : null) ??
    (columnEdit !== null
      ? `${columnEdit.kanban}#${columnEdit.column}`
      : null) ??
    mindmap.editingKey ??
    (labelState?.editing === true
      ? `${labelState.line}:${labelState.label}`
      : null);
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
    onTable: setPasteGrid,
  });

  // Выделенные ячейки живут, пока выделена одна их таблица: другое выделение их снимает.
  const [cellsFor, setCellsFor] = useState(selection);
  if (cellsFor !== selection) {
    setCellsFor(selection);
    if (
      cells !== null &&
      !(selection.length === 1 && selection[0] === cells.table)
    ) {
      setCells(null);
      setCellEdit(null);
    }
    if (
      column !== null &&
      !(selection.length === 1 && selection[0] === column.kanban)
    ) {
      setColumn(null);
      setColumnEdit(null);
    }
  }
  const cellTable =
    cells !== null && selectedIds.length === 1 && selectedIds[0] === cells.table
      ? (selected[0] ?? null)
      : null;
  // CVS-19: у заблокированной таблицы ячейки не выделяются и не правятся.
  const cellShape = cellTable?.locked === false ? cellTable.table : null;
  const activeCells = cellShape === null ? null : cells;
  const editedCell =
    cellEdit !== null && cellEdit.table === activeCells?.table
      ? cellEdit
      : null;

  useTableKeys(
    cellShape !== null && activeCells !== null && editedCell === null
      ? {
          table: cellShape,
          cells: activeCells,
          setCells,
          edit: (cell) => {
            editCell(activeCells.table, cell);
          },
          clear: (keys) => {
            if (cellTable === null) return;
            editTable(objects, cellTable, actor, (map) => {
              clearCells(map, keys);
            });
          },
          exit: () => {
            setCells(null);
          },
        }
      : null,
  );

  /** TBL-04: стрелка на краю текста или Tab переводит ввод в соседнюю ячейку. */
  function cellEditorKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (cellShape === null || editedCell === null) return;
    const exit = editorExit(event.key, event.currentTarget, event.shiftKey);
    if (exit === null) return;
    event.preventDefault();
    const next = cellAfter(cellShape, editedCell.cell, exit);
    if (next !== editedCell.cell) editCell(editedCell.table, next);
  }

  /** Точка доски под точкой окна; `null` — не над холстом. */
  function boardPointAt(client: Point): Point | null {
    const element = canvasRef.current;
    if (element === null || !isOverCanvas(element, client)) return null;
    const rect = element.getBoundingClientRect();
    return screenToBoard(
      { x: client.x - rect.left, y: client.y - rect.top },
      camera,
      { width: rect.width, height: rect.height },
    );
  }

  /**
   * CVS-09: инструмент отпустили над холстом — объект встаёт в эту точку; STK-01: образец
   * цвета — стикер этого цвета.
   */
  function drop(
    type: PlaceableType,
    client: Point,
    choice?: { fill?: string; shape?: string },
  ) {
    const at = boardPointAt(client);
    if (at === null) return;
    create(type, at, choice);
    setTool("select");
  }

  /**
   * STK-04: Tab в правке стикера — следующий стикер справа, сразу в правке. Его создание —
   * отдельный шаг отмены между правками двух стикеров (CVS-07).
   */
  function nextSticky(from: SceneObject) {
    history.end();
    history.begin();
    const id = createNextSticky(objects, from, actor);
    setSelection([id]);
    editText(id);
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

  const activeDrawTool = drawTool(tool);
  const [single] = units;
  const editableSingle =
    units.length === 1 && single !== undefined && !single.locked
      ? single
      : null;
  const editSelected =
    editableSingle !== null && typeSpec(editableSingle.type)?.editable === true
      ? () => {
          editText(editableSingle.id);
        }
      : null;
  // STK-03: теги одного стикера или стопки и показ автора стикера.
  const tagActions: TagActions | null =
    editableSingle !== null && TAGGED_TYPES.includes(editableSingle.type)
      ? {
          values: editableSingle.tags,
          add: (tag) => addTag(objects, editableSingle.id, tag, actor),
          remove: (tag) => {
            removeTag(objects, editableSingle.id, tag, actor);
          },
        }
      : null;
  const authorToggle: AuthorToggle | null =
    editableSingle?.type === "sticky"
      ? {
          shown: editableSingle.showAuthor,
          set: (shown) => {
            writeFields(
              objects,
              new Map([[editableSingle.id, { showAuthor: shown }]]),
              actor,
            );
          },
        }
      : null;

  // T6.8: действия одного выделенного канбана; выбранный столбец — если он ещё есть.
  const kanbanShape = editableSingle?.kanban ?? null;
  const activeColumn =
    kanbanShape !== null &&
    column !== null &&
    column.kanban === editableSingle?.id
      ? (kanbanShape.columns.find((c) => c.id === column.column) ?? null)
      : null;
  const editedColumn =
    editableSingle !== null &&
    activeColumn !== null &&
    columnEdit?.kanban === editableSingle.id &&
    columnEdit.column === activeColumn.id
      ? columnEdit
      : null;
  const kanbanActions: KanbanActions | null =
    editableSingle !== null && kanbanShape !== null
      ? {
          column: activeColumn,
          addCard: () => {
            const target = activeColumn ?? kanbanShape.columns[0];
            if (target === undefined) return;
            const id = addCard(objects, editableSingle, target.id, actor);
            setSelection([id]);
            editText(id);
          },
          addColumn: () => {
            const id = addColumn(
              objects,
              editableSingle,
              activeColumn?.id ?? null,
              actor,
            );
            if (id !== null) editColumn(editableSingle.id, id);
          },
          renameColumn:
            activeColumn === null
              ? null
              : () => {
                  editColumn(editableSingle.id, activeColumn.id);
                },
          deleteColumn:
            activeColumn === null || kanbanShape.columns.length < 2
              ? null
              : () => {
                  const target = {
                    kanban: editableSingle.id,
                    column: activeColumn.id,
                  };
                  // Пустой столбец удаляется сразу: решать про карточки не нужно.
                  if (columnCards(scene, target.kanban, target.column).length) {
                    setColumnDelete(target);
                  } else {
                    removeColumn(target, { kind: "delete" });
                  }
                },
        }
      : null;

  /** KBN-03: удалить столбец, решив судьбу его карточек. */
  function removeColumn(target: KanbanColumn, fate: ColumnFate) {
    const kanban = kanbanById(target.kanban);
    if (kanban === null) return;
    deleteColumn(board, kanban, target.column, fate, actor);
    setColumn(null);
    setColumnEdit(null);
  }

  // Вопрос об удалении — пока столбец ещё есть у незаблокированного канбана.
  const deleting =
    columnDelete === null ? null : kanbanById(columnDelete.kanban);
  const deletingColumn =
    deleting?.kanban?.columns.find((c) => c.id === columnDelete?.column) ??
    null;

  // T6.4: действия одной выделенной линии.
  const lineActions: LineActions | null =
    editableSingle?.line != null ? lineActionsFor(editableSingle) : null;

  // T6.7: действия одной выделенной таблицы.
  const tableActions =
    editableSingle?.table != null
      ? tableActionsFor({
          objects,
          scene,
          table: editableSingle,
          cells: activeCells,
          actor,
          setCells,
          editCell,
        })
      : null;

  function lineActionsFor(line: SceneObject): LineActions {
    const label = labelLine?.id === line.id ? activeLabel : null;
    return {
      swap: () => {
        swapEnds(objects, line, actor);
      },
      detach: isAttached(line)
        ? () => {
            detachLine(objects, line, actor);
          }
        : null,
      addLabel: () => {
        const id = addLabel(objects, line.id, LABEL_PLACES.center, actor);
        setLineLabel({ line: line.id, label: id, editing: true });
      },
      label:
        label === null
          ? null
          : {
              value: label,
              set: (fields) => {
                setLabel(objects, line.id, label.id, fields, actor);
              },
              edit: () => {
                setLineLabel({ line: line.id, label: label.id, editing: true });
              },
              remove: () => {
                removeLabel(objects, line.id, label.id, actor);
                setLineLabel(null);
              },
            },
    };
  }

  /** Конец правки подписи: пустая подпись убирается с линии. */
  function stopLabelEditing(line: SceneObject, labelId: string) {
    const fresh = readScene(objects).find((o) => o.id === line.id);
    const dropped = dropEmptyLabel(objects, fresh, labelId, actor);
    setLineLabel(
      dropped ? null : { line: line.id, label: labelId, editing: false },
    );
  }

  // SHP-04: свой цвет выделенных — в их свойство и в недавние цвета их категорий.
  const colorActions: ColorActions = {
    recent: recentColors.recent,
    pick: (key, color) => {
      commands.setStyle(key, color);
      const categories = editable
        .map((o) => colorCategory(o.type))
        .filter((c) => c !== null);
      recentColors.remember(categories, color);
    },
  };

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
    const next =
      typeof current === "number"
        ? fittedHeight(object.type, current, height)
        : null;
    if (next !== null) map.set("height", next);
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
          // CMT-01: ветка у правого верхнего угла объекта.
          comment:
            single !== undefined && units.length === 1
              ? () => {
                  startComment(single, {
                    x: single.x + single.width,
                    y: single.y,
                  });
                }
              : null,
        });
      case "canvas":
        return boardMenu(commands, current.board, current.clip, {
          create,
          comment: (at) => {
            startComment(null, at);
          },
          selectAll: () => {
            setSelection(
              topmost(
                visible,
                visible.map((o) => o.id),
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
              if (!searching) {
                comments.close();
                note.close();
              }
              setSearching((open) => !open);
            }}
          >
            Search
          </Button>
          <Button
            variant="ghost"
            className="tool-button"
            title="Show comment threads on this board."
            aria-pressed={comments.open}
            aria-label={
              comments.unreadTotal > 0
                ? `Comments, ${String(comments.unreadTotal)} unread`
                : "Comments"
            }
            data-unread={comments.unreadTotal > 0 ? "true" : undefined}
            onClick={() => {
              setSearching(false);
              note.close();
              comments.toggle();
            }}
          >
            Comments
            {comments.unreadTotal > 0 && (
              <span className="comment-badge" aria-hidden="true">
                {comments.unreadTotal}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            className="tool-button"
            title="Open the board note."
            aria-pressed={note.open}
            onClick={() => {
              if (!note.open) {
                setSearching(false);
                comments.close();
              }
              note.toggle();
            }}
          >
            Note
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
            objects={visible}
            selected={new Set(selectedIds)}
            editing={editing?.id ?? null}
            rich={richHandlers}
            label={labelState}
            tables={{
              cells:
                cellShape !== null && activeCells !== null
                  ? {
                      table: activeCells.table,
                      state: {
                        keys: new Set(selectedCells(cellShape, activeCells)),
                        focus:
                          ownerOf(cellShape, activeCells.focus) ??
                          activeCells.focus,
                        editing: editedCell?.cell ?? null,
                      },
                    }
                  : null,
              handles: editableSingle?.table != null ? editableSingle.id : null,
            }}
            kanban={
              editableSingle !== null && kanbanShape !== null
                ? {
                    kanban: editableSingle.id,
                    state: {
                      active: activeColumn?.id ?? null,
                      editing: editedColumn?.column ?? null,
                    },
                  }
                : null
            }
            mindmap={mindmap.layer}
          />
          {mindmap.editor}
          {editableSingle && editedColumn && (
            <TextEditor
              key={`${editedColumn.kanban}#${editedColumn.column}`}
              object={editableSingle}
              text={editedColumn.text}
              label="Column title"
              className="kanban-title-editor"
              style={
                columnEditorStyle(editableSingle, editedColumn.column) ?? {}
              }
              onKeyDown={(event) => {
                // Название — одна строка: Enter завершает правку.
                if (event.key === "Enter") {
                  event.preventDefault();
                  setColumnEdit(null);
                }
              }}
              onEdit={() => {
                const map = objectMap(objects, editedColumn.kanban);
                if (map !== null) touch(map, actor);
              }}
              onDone={() => {
                const done = editedColumn;
                setColumnEdit((current) => (current === done ? null : current));
              }}
            />
          )}
          {cellTable && editedCell && (
            <TextEditor
              key={`${editedCell.table}#${editedCell.cell}`}
              object={cellTable}
              text={editedCell.text}
              label="Table cell"
              className="table-cell-editor"
              caretAtEnd
              style={cellEditorStyle(cellTable, editedCell.cell) ?? {}}
              onKeyDown={cellEditorKey}
              onEdit={() => {
                const map = objectMap(objects, cellTable.id);
                if (map !== null) touch(map, actor);
              }}
              onDone={() => {
                const done = editedCell;
                setCellEdit((current) => (current === done ? null : current));
              }}
            />
          )}
          {labelLine && activeLabel && labelState?.editing && (
            <LabelEditor
              key={`${labelLine.id}:${activeLabel.id}`}
              line={labelLine}
              text={labelText(objects, labelLine.id, activeLabel.id)}
              style={labelEditorStyle(labelLine, activeLabel)}
              onEdit={() => {
                const map = objectMap(objects, labelLine.id);
                if (map !== null) touch(map, actor);
              }}
              onDone={() => {
                stopLabelEditing(labelLine, activeLabel.id);
              }}
            />
          )}
          {editedObject && editing && isRichText(editedObject.type) && (
            <RichTextEditor
              key={editedObject.id}
              type={editedObject.type}
              text={editing.text}
              style={editorStyle(editedObject)}
              camera={camera}
              objectLabel={label}
              onEdit={(height) => {
                onRichEdit(editedObject, height);
              }}
              onDone={() => {
                stopEditingOf(editedObject.id);
              }}
              onPickObject={(done) => {
                setPicker({ done });
              }}
              {...(editedObject.type === "sticky" && {
                autoFit:
                  (editedObject.style.fontSize ?? AUTO_FONT_SIZE) ===
                  AUTO_FONT_SIZE,
                onTab: () => {
                  nextSticky(editedObject);
                },
              })}
            />
          )}
          {editedObject && editing && !isRichText(editedObject.type) && (
            <TextEditor
              key={editedObject.id}
              object={editedObject}
              {...(editedObject.type === "shape" && {
                style: {
                  ...objectStyle(editedObject),
                  ...shapeEditorStyle(editedObject),
                },
              })}
              {...(editedObject.flip !== null && {
                label: "Flip card side text",
                style: flipEditorStyle(editedObject, editedObject.flip),
              })}
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
          <ConnectOverlay hint={hint} />
          <InkOverlay ink={ink} />
          <ReactionDraftView draft={reactionDraft} />
          <LaserView
            lines={laser.trail}
            color={OWN_LASER_COLOR}
            label="Your laser"
          />
          {comments.pins}
          {worldOverlay}
        </BoardCanvas>
        <SelectionBar
          // Пока правят форматированный текст, над ним — панель редактора, а не выделения.
          selected={
            editedObject !== null && isRichText(editedObject.type) ? [] : units
          }
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
          tags={tagActions}
          author={authorToggle}
          colors={colorActions}
          line={lineActions}
          table={tableActions}
          kanban={kanbanActions}
          mindmap={mindmap.actions}
          flip={flipAndDice.flip}
          dice={flipAndDice.dice}
          frame={
            commands.lockFrames || commands.frameContent || commands.keepRatio
              ? {
                  lock: commands.lockFrames,
                  content: commands.frameContent,
                  keepRatio: commands.keepRatio,
                }
              : null
          }
        />
        {(tool === "sticky" || tool === "stack") && (
          <StickyPalette
            color={stickyColor}
            recent={recentColors.recent.sticky}
            onColor={(color) => {
              setStickyColor(color);
              rememberStickyColor(color);
            }}
            onCustom={(color) => {
              setStickyColor(color);
              rememberStickyColor(color);
              recentColors.remember(["sticky"], color);
            }}
            onDrop={(color, client) => {
              drop("sticky", client, { fill: color });
            }}
          />
        )}
        {activeDrawTool !== null && (
          <DrawPanel
            tool={activeDrawTool}
            settings={drawing.settings}
            recent={recentColors.recent.drawing}
            onTool={setTool}
            onBrush={drawing.setBrush}
            onCustomColor={(brush, color) => {
              drawing.setBrush(brush, (current) => ({ ...current, color }));
              recentColors.remember(["drawing"], color);
            }}
            onStylusDraws={drawing.setStylusDraws}
          />
        )}
        {tool === "reaction" && (
          <ReactionPalette
            current={reactionChoice.current}
            recent={reactionChoice.recent}
            onPick={reactions.pick}
          />
        )}
        {tool === "shape" && (
          <ShapePalette
            kind={shapeChoice}
            onKind={(kind) => {
              setShapeChoice(kind);
              rememberShapeKind(kind);
            }}
            onDrop={(kind, client) => {
              drop("shape", client, { shape: kind });
            }}
          />
        )}
        {stageOverlay}
        {comments.panel}
        {note.panel}
        {searching && (
          <BoardSearch
            scene={visible}
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
        {pasteGrid !== null && (
          <PasteTableChoice
            grid={pasteGrid}
            onTable={() => {
              setPasteGrid(null);
              commands.pasteTable(pasteGrid);
            }}
            onStickies={() => {
              setPasteGrid(null);
              commands.pasteStickies(pasteGrid);
            }}
            onCancel={() => {
              setPasteGrid(null);
            }}
          />
        )}
        {mindmap.dialog}
        {deleting && deletingColumn && (
          <DeleteColumnDialog
            title={deletingColumn.title}
            cards={columnCards(scene, deleting.id, deletingColumn.id).length}
            targets={(deleting.kanban?.columns ?? []).filter(
              (c) => c.id !== deletingColumn.id,
            )}
            onDelete={(fate) => {
              setColumnDelete(null);
              removeColumn(
                { kanban: deleting.id, column: deletingColumn.id },
                fate,
              );
            }}
            onCancel={() => {
              setColumnDelete(null);
            }}
          />
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

/** DRW-05: свой след лазера — красный; чужие — цветом участника. */
const OWN_LASER_COLOR = "#ef4444";

function ignoreLaser(): void {
  // Без канала присутствия (тесты сцены) след виден только здесь.
}

/** CON-03: поле правки подписи линии — на месте подписи. */
function LabelEditor({
  line,
  text,
  style,
  onEdit,
  onDone,
}: {
  line: SceneObject;
  text: Y.Text | null;
  style: CSSProperties;
  onEdit: () => void;
  onDone: () => void;
}) {
  if (text === null) return null;
  return (
    <TextEditor
      object={line}
      text={text}
      style={style}
      label="Line label"
      onEdit={onEdit}
      onDone={onDone}
    />
  );
}

/** Поле правки подписи: по центру места подписи, оформление — как у подписи (CON-04). */
function labelEditorStyle(
  line: SceneObject,
  label: NonNullable<SceneObject["line"]>["labels"][number],
): CSSProperties {
  const { point } = labelPlace(line, label);
  const lines = Math.max(1, label.text.split("\n").length);
  const width = 220;
  const height = lines * label.fontSize * 1.3 + 12;
  return {
    left: point.x - width / 2,
    top: point.y - height / 2,
    width,
    height,
    ...labelTextStyle(label),
  };
}

/**
 * Вид поля правки поверх объекта. Стикер — с прозрачным фоном: под полем видны его цвет,
 * теги и автор (STK-03).
 */
function editorStyle(object: SceneObject): CSSProperties {
  const style = objectStyle(object);
  return object.type === "sticky"
    ? { ...style, background: "transparent", boxShadow: "none" }
    : style;
}

/** FLP-03: поле правки стороны флип-карточки — её цвет, размер и форматирование текста. */
function flipEditorStyle(
  object: SceneObject,
  flip: NonNullable<SceneObject["flip"]>,
): CSSProperties {
  const side = flip[shownSide(flip)];
  return {
    ...objectStyle(object),
    ...sideTextStyle(side),
    background: side.fill,
  };
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
