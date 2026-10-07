import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BoardCanvas, type CameraUpdate } from "../canvas/BoardCanvas";
import { screenToBoard, type Size } from "../canvas/camera";
import { isTypingTarget } from "../canvas/keyboard";
import type { WheelMode } from "../canvas/wheel";
import type * as Y from "yjs";
import { moveToTrash, type BoardDocument } from "../realtime/boardDocument";
import type { CameraView, Point } from "../realtime/messages";
import { isDark, useBoardSettings } from "./boardSettings";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { AreaDraft } from "./gestures";
import {
  OBJECT_TYPES,
  typeSpec,
  type ObjectType,
  type StyleKey,
} from "./objectTypes";
import { AreaOverlay, SceneLayer } from "./SceneLayer";
import {
  createObject,
  objectText,
  patchObjects,
  readScene,
  type ObjectPatch,
  type SceneObject,
} from "./sceneObjects";
import { SelectionBar } from "./SelectionBar";
import { SelectionOverlay } from "./SelectionOverlay";
import { TextEditor } from "./TextEditor";
import { ToolPanel } from "./ToolPanel";
import { placement, type ToolId } from "./tools";
import { useSceneGestures } from "./useSceneGestures";
import { useSceneObjects } from "./useSceneObjects";
import "./scene.css";

type Menu =
  { kind: "object"; at: Point } | { kind: "canvas"; at: Point; board: Point };

/**
 * Сцена доски: объекты документа на холсте, инструменты, выделение и правки (T5.2).
 * Объекты общие — правку одного участника видят все (документ Yjs); инструмент,
 * выделение и меню — свои у каждой вкладки.
 *
 * CVS-06 фон и сетка, CVS-09 создание, CVS-10 выделение, CVS-11 фильтр и массовые свойства,
 * CVS-12 перемещение, CVS-13 автопрокрутка, CVS-14 размер и поворот, CVS-21 удаление,
 * CVS-23 контекстное меню, MOB-03 долгое нажатие.
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
}: {
  board: BoardDocument;
  camera: CameraView;
  wheelMode: WheelMode;
  /** Имя удалившего для записи корзины. */
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
}) {
  const { objects } = board;
  const scene = useSceneObjects(objects);
  const settings = useBoardSettings(board.settings);
  const [tool, setTool] = useState<ToolId>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: Y.Text } | null>(
    null,
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<Point | null>(null);

  // Объект, удалённый другим участником, пропадает из выделения сам.
  const selected = useMemo(
    () => scene.filter((o) => selection.includes(o.id)),
    [scene, selection],
  );
  const selectedIds = useMemo(
    () => new Set(selected.map((o) => o.id)),
    [selected],
  );
  const editedObject = scene.find((o) => o.id === editing?.id) ?? null;

  const editText = useCallback(
    (id: string) => {
      const text = objectText(objects, id);
      setEditing(text === null ? null : { id, text });
    },
    [objects],
  );
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  const create = useCallback(
    (type: ObjectType, at: Point): SceneObject | null => {
      const id = createObject(
        objects,
        type,
        placement(type, at, settings.gridStep),
      );
      setSelection([id]);
      return readScene(objects).find((o) => o.id === id) ?? null;
    },
    [objects, settings.gridStep],
  );

  const remove = useCallback(
    (ids: readonly string[]) => {
      moveToTrash(board, ids, userName);
      setSelection([]);
      setEditing(null);
    },
    [board, userName],
  );

  const gestures = useSceneGestures({
    objects,
    scene,
    selection,
    tool,
    gridStep: settings.gridStep,
    select: setSelection,
    setTool,
    setDraft,
    create,
    openMenu: (next, at) => {
      setMenu(
        next.kind === "object" ? { kind: "object", at } : { ...next, at },
      );
    },
    editText,
  });

  // CVS-21: Delete/Backspace удаляют выделенное; Escape снимает выделение.
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selected.length === 0) return;
        event.preventDefault();
        remove(selected.map((o) => o.id));
      } else if (event.key === "Escape") {
        setSelection([]);
        setTool("select");
      }
    }
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
    };
  }, [selected, remove]);

  // CVS-09: вставка текста из буфера ставит текстовый объект под указателем
  // (или в центре вида, если указатель не над холстом).
  useEffect(() => {
    function paste(event: ClipboardEvent) {
      if (isTypingTarget(event.target)) return;
      const text = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (!text) return;
      event.preventDefault();
      const at = pointer.current ?? { x: camera.x, y: camera.y };
      const id = createObject(
        objects,
        "text",
        placement("text", at, settings.gridStep),
        text,
      );
      setSelection([id]);
    }
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("paste", paste);
    };
  }, [objects, camera.x, camera.y, settings.gridStep]);

  function setStyle(key: StyleKey, value: string | number) {
    const patches = new Map<SceneObject, ObjectPatch>();
    for (const object of selected) patches.set(object, { [key]: value });
    patchObjects(objects, patches);
  }

  /** CVS-09: инструмент отпустили над холстом — объект встаёт в эту точку. */
  function drop(type: ObjectType, client: Point) {
    const element = canvasRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const inside =
      client.x >= rect.left &&
      client.x <= rect.right &&
      client.y >= rect.top &&
      client.y <= rect.bottom;
    if (!inside) return;
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

  const single = selected.length === 1 ? selected[0] : undefined;
  const editSelected =
    single !== undefined && typeSpec(single.type) !== undefined
      ? () => {
          editText(single.id);
        }
      : null;

  function menuItems(current: Menu): MenuItem[] {
    if (current.kind === "object") {
      const items: MenuItem[] = [];
      if (editSelected)
        items.push({ label: "Edit text", action: editSelected });
      items.push({
        label:
          selected.length > 1
            ? `Delete ${String(selected.length)} objects`
            : "Delete",
        action: () => {
          remove(selected.map((o) => o.id));
        },
      });
      return items;
    }
    return [
      ...Object.values(OBJECT_TYPES).map((spec) => ({
        label: `Add ${spec.label.toLowerCase()} here`,
        action: () => {
          create(spec.type, current.board);
        },
      })),
      {
        label: "Select all",
        action: () => {
          setSelection(scene.map((o) => o.id));
        },
      },
    ];
  }

  return (
    <div className="board-scene">
      <ToolPanel tool={tool} onTool={setTool} onDrop={drop} />
      <div className="board-stage" style={stageStyle} {...stageAttributes}>
        <BoardCanvas
          camera={camera}
          wheelMode={wheelMode}
          background={settings.background}
          dotColor={isDark(settings.background) ? "#5f6b73" : "#c8c8c8"}
          gridStep={settings.gridStep}
          gestures={gestures}
          canvasRef={canvasRef}
          onMove={onMove}
          onPointer={(point) => {
            pointer.current = point;
            onPointer(point);
          }}
          onResize={onResize}
        >
          <SceneLayer
            objects={scene}
            selected={selectedIds}
            editing={editing?.id ?? null}
          />
          {editedObject && editing && (
            <TextEditor
              key={editedObject.id}
              object={editedObject}
              text={editing.text}
              onDone={() => {
                setEditing(null);
              }}
            />
          )}
          <SelectionOverlay selected={selected} />
          <AreaOverlay draft={draft} />
          {worldOverlay}
        </BoardCanvas>
        <SelectionBar
          selected={selected}
          onFilter={(type) => {
            setSelection(
              selected.filter((o) => o.type === type).map((o) => o.id),
            );
          }}
          onStyle={setStyle}
          onEditText={editSelected}
          onDelete={() => {
            remove(selected.map((o) => o.id));
          }}
        />
        {stageOverlay}
        {menu && (
          <ContextMenu
            label={menu.kind === "object" ? "Object menu" : "Board menu"}
            at={menu.at}
            items={menuItems(menu)}
            onClose={closeMenu}
          />
        )}
      </div>
    </div>
  );
}
