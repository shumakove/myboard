import { useCallback, useState } from "react";
import type * as Y from "yjs";
import { NotePanel } from "./NotePanel";
import { isNoteOpenForAll } from "./noteData";

/**
 * Заметка доски (NTE-01…NTE-03) для сцены: открыта ли панель заметки и сама панель.
 * NTE-02: закреплённая заметка открывается сама один раз — когда документ сверен
 * с сервером (`loaded`): раньше флага в документе ещё нет. Закрыть её можно как обычно.
 */
export function useBoardNote({
  notes,
  loaded,
  objectLabel,
  onOpenObject,
  onPickObject,
}: {
  notes: Y.XmlFragment;
  loaded: boolean;
  objectLabel: (id: string) => string | null;
  /** NTE-03: щелчок по ссылке на объект в заметке. */
  onOpenObject: (id: string) => void;
  /** NTE-03: выбор объекта для ссылки (тот же диалог, что у документа). */
  onPickObject: (done: (id: string | null) => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  // Вход на доску: состояние меняется при отрисовке, как только документ сверен.
  if (loaded && !entered) {
    setEntered(true);
    if (isNoteOpenForAll(notes)) setOpen(true);
  }

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const panel = open ? (
    <NotePanel
      notes={notes}
      objectLabel={objectLabel}
      onOpenObject={onOpenObject}
      onPickObject={onPickObject}
      onClose={close}
    />
  ) : null;

  return {
    open,
    toggle: () => {
      setOpen((current) => !current);
    },
    close,
    panel,
  };
}
