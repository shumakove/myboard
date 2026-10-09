import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as Y from "yjs";
import type { CanvasGestures } from "../canvas/BoardCanvas";
import type { BoardDocument } from "../realtime/boardDocument";

/**
 * CVS-07: отмена и повтор своих правок (ARCHITECTURE.md, раздел 4) — локальный
 * Y.UndoManager. В стек попадают только транзакции этого клиента (origin `null`);
 * чужие правки приходят с origin соединения и не откатываются, а отмена не
 * перезаписывает поле, которое после нас изменил другой участник.
 *
 * Шаг отмены — одно действие: команда, весь жест от нажатия до отпускания или
 * сеанс правки текста. Вне жеста каждая транзакция — отдельный шаг.
 */
interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false };

export class UndoHistory {
  private manager: Y.UndoManager | null = null;
  private open = 0;
  private readonly listeners = new Set<() => void>();
  private state = NO_HISTORY;

  constructor(readonly board: BoardDocument) {}

  /** Начать слушать правки документа (эффект компонента). */
  attach(): void {
    if (this.manager !== null) return;
    const { objects, trash, settings } = this.board;
    // Удаление переносит объект в trash, поэтому корзина — в той же области отмены.
    const manager = new Y.UndoManager([objects, trash, settings], {
      captureTimeout: 0,
    });
    for (const event of [
      "stack-item-added",
      "stack-item-popped",
      "stack-cleared",
    ] as const) {
      manager.on(event, this.changed);
    }
    this.manager = manager;
    this.open = 0;
  }

  detach(): void {
    this.manager?.destroy();
    this.manager = null;
    this.changed();
  }

  undo(): void {
    this.manager?.undo();
  }

  redo(): void {
    this.manager?.redo();
  }

  /** Начало жеста или правки текста: все правки до `end` — один шаг. */
  begin(): void {
    const manager = this.manager;
    if (manager === null) return;
    manager.stopCapturing();
    this.open += 1;
    manager.captureTimeout = Number.POSITIVE_INFINITY;
  }

  end(): void {
    const manager = this.manager;
    if (manager === null) return;
    this.open = Math.max(0, this.open - 1);
    manager.stopCapturing();
    if (this.open === 0) manager.captureTimeout = 0;
  }

  /** Правка — в тот же шаг отмены, что и только что сделанная своя (подгонка высоты). */
  amend(write: () => void): void {
    const manager = this.manager;
    if (manager === null) {
      write();
      return;
    }
    const timeout = manager.captureTimeout;
    manager.captureTimeout = Number.POSITIVE_INFINITY;
    try {
      write();
    } finally {
      manager.captureTimeout = timeout;
    }
  }

  /** Состояние кнопок Undo/Redo — для `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): HistoryState => this.state;

  private readonly changed = (): void => {
    const canUndo = this.manager?.canUndo() ?? false;
    const canRedo = this.manager?.canRedo() ?? false;
    if (canUndo === this.state.canUndo && canRedo === this.state.canRedo) {
      return;
    }
    this.state = { canUndo, canRedo };
    for (const listener of this.listeners) listener();
  };
}

/** История отмены доски на время жизни компонента. */
export function useUndoHistory(
  board: BoardDocument,
): { history: UndoHistory } & HistoryState {
  const history = useMemo(() => new UndoHistory(board), [board]);
  useEffect(() => {
    // В StrictMode эффект снимается и ставится заново — UndoManager создаётся снова.
    history.attach();
    return () => {
      history.detach();
    };
  }, [history]);
  const state = useSyncExternalStore(history.subscribe, history.snapshot);
  return { history, ...state };
}

/** Жест на холсте — один шаг отмены: от `start` до `end`, `click` или `cancel`. */
export function withUndoSteps(
  gestures: CanvasGestures,
  history: UndoHistory,
): CanvasGestures {
  return {
    ...gestures,
    start(press, longPress) {
      history.begin();
      const gesture = gestures.start(press, longPress);
      if (gesture === null) {
        history.end();
        return null;
      }
      const { click } = gesture;
      return {
        ...gesture,
        end: (pointer) => {
          gesture.end(pointer);
          history.end();
        },
        cancel: () => {
          gesture.cancel();
          history.end();
        },
        // Без `click` отпускание на месте вызовет `cancel` — так и остаётся.
        ...(click && {
          click: () => {
            click();
            history.end();
          },
        }),
      };
    },
  };
}
