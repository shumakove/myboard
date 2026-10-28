import { useEffect, useState, type MouseEvent } from "react";
import type * as Y from "yjs";
import type { CameraView } from "../realtime/messages";
import { RichText, type RichTextActions } from "../richtext/RichText";
import { RichTextEditor } from "../richtext/RichTextEditor";
import { Button, FloatingPanel, Switch } from "../ui";
import {
  checkNoteItem,
  ensureNoteText,
  isNoteOpenForAll,
  noteOps,
  noteText,
  setNoteOpenForAll,
} from "./noteData";
import "./notes.css";

/** Редактор в панели не масштабируется вместе с холстом. */
const PANEL_VIEW: CameraView = { x: 0, y: 0, zoom: 1 };

/** Перерисовка при любой правке заметки — своей или другого участника. */
function useNoteVersion(notes: Y.XmlFragment): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => {
      setVersion((v) => v + 1);
    };
    notes.observeDeep(bump);
    return () => {
      notes.unobserveDeep(bump);
    };
  }, [notes]);
  return version;
}

/**
 * Панель заметки доски — отдельно от холста, поверх него (NTE-01): показ заметки и её
 * правка тем же редактором, что у документа (блоки, меню «/», ссылки на объекты —
 * TXT-02…TXT-04, TXT-06). Переключатель Open for everyone закрепляет заметку (NTE-02).
 * Ссылка на объект в показе переводит к нему вид (NTE-03). Escape закрывает панель,
 * в редакторе — только завершает правку.
 */
export function NotePanel({
  notes,
  objectLabel,
  onOpenObject,
  onPickObject,
  onClose,
}: {
  notes: Y.XmlFragment;
  objectLabel: (id: string) => string | null;
  onOpenObject: (id: string) => void;
  onPickObject: (done: (id: string | null) => void) => void;
  onClose: () => void;
}) {
  useNoteVersion(notes);
  const [editing, setEditing] = useState<Y.XmlText | null>(null);
  const openForAll = isNoteOpenForAll(notes);

  const startEditing = () => {
    setEditing(ensureNoteText(notes));
  };

  const actions: RichTextActions = {
    onCheck: (end, checked) => {
      checkNoteItem(notes, end, checked);
    },
    onOpenObject,
    objectLabel,
  };

  return (
    <FloatingPanel
      role="region"
      aria-label="Board note"
      className="note-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Escape в редакторе завершает правку (сам редактор), панель остаётся.
        if (
          event.target instanceof Element &&
          event.target.closest(".rich-editor") !== null
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="note-panel-head">
        <h2>Board note</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <Switch
        label="Open for everyone"
        title="Open this note for everyone who enters the board."
        checked={openForAll}
        onChange={(event) => {
          setNoteOpenForAll(notes, event.target.checked);
        }}
      />
      {editing !== null && editing === noteText(notes) ? (
        <RichTextEditor
          type="note"
          className="note-editor"
          text={editing}
          style={{}}
          camera={PANEL_VIEW}
          objectLabel={objectLabel}
          selectAll={false}
          onEdit={ignoreHeight}
          onDone={() => {
            setEditing(null);
          }}
          onPickObject={onPickObject}
        />
      ) : (
        <>
          <div
            className="note-view"
            onClick={(event) => {
              if (!isControl(event)) startEditing();
            }}
          >
            <RichText
              ops={noteOps(notes)}
              placeholder="Empty note. Select Edit note to write."
              actions={actions}
            />
          </div>
          <div className="note-actions">
            <Button onClick={startEditing}>Edit note</Button>
          </div>
        </>
      )}
    </FloatingPanel>
  );
}

function ignoreHeight(): void {
  // Высота панели следует за содержимым сама.
}

/** Щелчок по флажку, ссылке или кнопке ссылки на объект — не вход в правку. */
function isControl(event: MouseEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("a, button, input") !== null
  );
}
