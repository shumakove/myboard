import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import { isTypingTarget } from "../canvas/keyboard";
import { nodeText, type NodeDrop } from "./mindmapData";
import {
  addChild,
  addSibling,
  deleteNode,
  moveNode,
  nodeEditorStyle,
  recolorNode,
  toggleNode as toggleBranch,
} from "./mindmaps";
import { RecolorDialog, type MindmapActions } from "./MindmapControls";
import type { NodeDragState } from "./MindmapView";
import type { MindmapLayerState } from "./SceneLayer";
import { objectMap, readScene, touch, type SceneObject } from "./sceneObjects";
import { TextEditor } from "./TextEditor";
import { dialogOpen } from "./useSceneShortcuts";

/** Узел интеллект-карты. */
interface NodeRef {
  mindmap: string;
  node: string;
}

type NodeDrag = NodeDragState & { mindmap: string };

export interface MindmapNodes {
  /** Для жестов сцены (useSceneGestures). */
  selectNode: (mindmap: string, node: string) => void;
  editNode: (mindmap: string, node: string) => void;
  toggleNode: (mindmap: string, node: string) => void;
  dragNode: (drag: NodeDrag | null) => void;
  dropNode: (mindmap: string, node: string, drop: NodeDrop) => void;
  /** Ключ сеанса правки названия — один шаг отмены (CVS-07); не правят — `null`. */
  editingKey: string | null;
  /** Состояние карты для SceneLayer. */
  layer: MindmapLayerState | null;
  /** Действия в панели выделения. */
  actions: MindmapActions | null;
  /** Поле правки названия узла — в слое камеры. */
  editor: ReactNode;
  /** MAP-04: вопрос о перекраске дочерних узлов. */
  dialog: ReactNode;
}

/**
 * Узлы интеллект-карты на холсте (T6.9): выбор узла, правка названия, новые узлы,
 * перекраска с вопросом о детях (MAP-04), сворачивание (MAP-03), перестановка (MAP-02).
 * Пока выбран узел (и его название не правят), клавиши работают с узлом: Tab — новый
 * дочерний, Enter — новый соседний, F2 — правка названия, Delete и Backspace — удалить
 * узел (а не карту; у корня клавиши ничего не делают), Escape — снять выбор узла.
 */
export function useMindmapNodes({
  objects,
  scene,
  selection,
  select,
  actor,
}: {
  objects: Y.Map<unknown>;
  scene: readonly SceneObject[];
  selection: readonly string[];
  select: (ids: string[]) => void;
  actor: string;
}): MindmapNodes {
  const [picked, setPicked] = useState<NodeRef | null>(null);
  const [edit, setEdit] = useState<(NodeRef & { text: Y.Text }) | null>(null);
  const [recolor, setRecolor] = useState<(NodeRef & { color: string }) | null>(
    null,
  );
  const [drag, setDrag] = useState<NodeDrag | null>(null);

  /** Карта для действий с узлами: есть на доске и не заблокирована (CVS-19). */
  const mindmapById = useCallback(
    (id: string): SceneObject | null => {
      const target = readScene(objects).find((o) => o.id === id);
      return target?.mindmap != null && !target.locked ? target : null;
    },
    [objects],
  );

  const selectNode = useCallback(
    (mindmap: string, node: string) => {
      if (mindmapById(mindmap) === null) return;
      select([mindmap]);
      setPicked({ mindmap, node });
    },
    [mindmapById, select],
  );

  const editNode = useCallback(
    (mindmap: string, node: string) => {
      const map = objectMap(objects, mindmap);
      if (mindmapById(mindmap) === null || map === null) return;
      const text = nodeText(map, node);
      if (text === null) return;
      select([mindmap]);
      setPicked({ mindmap, node });
      setEdit({ mindmap, node, text });
    },
    [objects, mindmapById, select],
  );

  const toggleNode = useCallback(
    (mindmap: string, node: string) => {
      if (mindmapById(mindmap) === null) return;
      toggleBranch(objects, mindmap, node, actor);
    },
    [objects, mindmapById, actor],
  );

  const dropNode = useCallback(
    (mindmap: string, node: string, drop: NodeDrop) => {
      if (mindmapById(mindmap) === null) return;
      moveNode(objects, mindmap, node, drop, actor);
      setPicked({ mindmap, node });
    },
    [objects, mindmapById, actor],
  );

  // Выбранный узел живёт, пока выделена одна его карта: другое выделение его снимает.
  const [pickedFor, setPickedFor] = useState(selection);
  if (pickedFor !== selection) {
    setPickedFor(selection);
    if (
      picked !== null &&
      !(selection.length === 1 && selection[0] === picked.mindmap)
    ) {
      setPicked(null);
      setEdit(null);
    }
  }

  const [only] = selection;
  const found =
    selection.length === 1 ? scene.find((o) => o.id === only) : undefined;
  const current = found?.mindmap != null && !found.locked ? found : null;
  const shape = current?.mindmap ?? null;
  // Выбранный узел — если он ещё виден (не удалён и не в свёрнутой ветке).
  const activeNode =
    current !== null && picked?.mindmap === current.id
      ? (shape?.nodes.find((n) => n.id === picked.node) ?? null)
      : null;
  const editorStyle =
    current !== null && edit?.mindmap === current.id
      ? nodeEditorStyle(current, edit.node)
      : null;
  const edited = editorStyle !== null ? edit : null;

  const addNode = (add: typeof addChild, from: string) => {
    if (current === null) return;
    const id = add(objects, current.id, from, actor);
    if (id !== null) editNode(current.id, id);
  };

  const actions: MindmapActions | null =
    current === null || shape === null
      ? null
      : {
          node:
            activeNode === null
              ? null
              : {
                  id: activeNode.id,
                  text: activeNode.text,
                  color: activeNode.color,
                  root: activeNode.parent === null,
                  branch: activeNode.children.length > 0,
                  collapsed: activeNode.collapsed,
                },
          addChild: () => {
            addNode(addChild, activeNode?.id ?? shape.root);
          },
          addSibling:
            activeNode === null || activeNode.parent === null
              ? null
              : () => {
                  addNode(addSibling, activeNode.id);
                },
          rename:
            activeNode === null
              ? null
              : () => {
                  editNode(current.id, activeNode.id);
                },
          recolor:
            activeNode === null
              ? null
              : (color) => {
                  // MAP-04: у узла с детьми — вопрос, перекрашивать ли и их.
                  if (activeNode.descendants > 0) {
                    setRecolor({
                      mindmap: current.id,
                      node: activeNode.id,
                      color,
                    });
                  } else {
                    recolorNode(
                      objects,
                      current.id,
                      activeNode.id,
                      color,
                      false,
                      actor,
                    );
                  }
                },
          toggle:
            activeNode === null
              ? null
              : () => {
                  toggleNode(current.id, activeNode.id);
                },
          remove:
            activeNode === null || activeNode.parent === null
              ? null
              : () => {
                  deleteNode(objects, current.id, activeNode.id, actor);
                  setPicked(null);
                },
        };

  useNodeKeys(
    actions !== null && activeNode !== null && edited === null
      ? {
          addChild: actions.addChild,
          addSibling: actions.addSibling ?? actions.addChild,
          rename: actions.rename,
          remove: actions.remove,
          exit: () => {
            setPicked(null);
          },
        }
      : null,
  );

  const recolored =
    recolor === null ? null : mindmapById(recolor.mindmap)?.mindmap;
  const recoloredNode = recolor && recolored?.byId.get(recolor.node);

  return {
    selectNode,
    editNode,
    toggleNode,
    dragNode: setDrag,
    dropNode,
    editingKey: edited === null ? null : `${edited.mindmap}#${edited.node}`,
    layer:
      current === null
        ? null
        : {
            mindmap: current.id,
            state: {
              active: activeNode?.id ?? null,
              editing: edited?.node ?? null,
              drag: drag?.mindmap === current.id ? drag : null,
            },
          },
    actions,
    editor: current !== null && edited !== null && editorStyle !== null && (
      <TextEditor
        key={`${edited.mindmap}#${edited.node}`}
        object={current}
        text={edited.text}
        label="Node title"
        className="mindmap-node-editor"
        style={editorStyle}
        onKeyDown={(event) => {
          // Название — одна строка: Enter завершает правку.
          if (event.key === "Enter") {
            event.preventDefault();
            setEdit(null);
          }
        }}
        onEdit={() => {
          const map = objectMap(objects, edited.mindmap);
          if (map !== null) touch(map, actor);
        }}
        onDone={() => {
          setEdit((now) => (now === edited ? null : now));
        }}
      />
    ),
    dialog: recolor !== null && recoloredNode != null && (
      <RecolorDialog
        text={recoloredNode.text}
        count={recoloredNode.descendants}
        onAnswer={(withChildren) => {
          recolorNode(
            objects,
            recolor.mindmap,
            recolor.node,
            recolor.color,
            withChildren,
            actor,
          );
          setRecolor(null);
        }}
        onCancel={() => {
          setRecolor(null);
        }}
      />
    ),
  };
}

interface NodeKeys {
  addChild: () => void;
  addSibling: () => void;
  rename: (() => void) | null;
  remove: (() => void) | null;
  exit: () => void;
}

/** Клавиши выбранного узла; перехватываются раньше команд сцены (Delete — не вся карта). */
function useNodeKeys(target: NodeKeys | null): void {
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  });
  const active = target !== null;

  useEffect(() => {
    if (!active) return;
    function keydown(event: KeyboardEvent) {
      const keys = latest.current;
      if (
        keys === null ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTypingTarget(event.target) ||
        dialogOpen()
      ) {
        return;
      }
      const action: (() => void) | null | undefined = {
        Tab: keys.addChild,
        Enter: keys.addSibling,
        F2: keys.rename,
        Delete: keys.remove,
        Backspace: keys.remove,
        Escape: keys.exit,
      }[event.key];
      if (action === undefined) return;
      // Клавиша узла поглощается, даже если действия нет: Delete у корня не должен
      // уйти в команды сцены и удалить всю карту (BUG-025, MAP-02).
      event.preventDefault();
      action?.();
    }
    window.addEventListener("keydown", keydown, { capture: true });
    return () => {
      window.removeEventListener("keydown", keydown, { capture: true });
    };
  }, [active]);
}
