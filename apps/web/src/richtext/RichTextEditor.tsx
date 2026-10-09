import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type * as Y from "yjs";
import type { CameraView } from "../realtime/messages";
import { Button, Menu, MenuItem, TextField } from "../ui";
import { bindQuill } from "./binding";
import { contentHeight } from "./measure";
import {
  DEFAULT_PLACEMENT,
  measurePlacement,
  type EditorPlacement,
} from "./placement";
import {
  createQuill,
  type Delta,
  DOCUMENT_FORMATS,
  minimalChange,
  setObjectLabel,
  TEXT_FORMATS,
  type Quill,
} from "./quill";
import { applyShortcut, insertedAt } from "./shortcuts";
import { afterBreak, SLASH_COMMANDS, slashMatches } from "./slashCommands";
import "./richText.css";

/**
 * Меню «/»: где стоит «/», что набрано после него, выбранный пункт и строка курсора
 * в единицах доски относительно редактора (`top` / `bottom` — верх и низ строки).
 */
interface Slash {
  start: number;
  query: string;
  active: number;
  at: { left: number; top: number; bottom: number };
}

interface Range {
  index: number;
  length: number;
}

/** Кнопки начертания панели редактора (TXT-02). */
const MARKS = [
  { format: "bold", label: "Bold", text: "B", keys: "Control+B Meta+B" },
  { format: "italic", label: "Italic", text: "I", keys: "Control+I Meta+I" },
  {
    format: "underline",
    label: "Underline",
    text: "U",
    keys: "Control+U Meta+U",
  },
  { format: "strike", label: "Strikethrough", text: "S", keys: "" },
] as const;

/**
 * Редактор форматированного текста объекта поверх него (TXT-01…TXT-04, TXT-06, TXT-08):
 * Quill в обычном поле `contenteditable`, связанный с `Y.Text` объекта (COL-01).
 * - панель над полем: жирный, курсив, подчёркнутый, зачёркнутый, ссылка (TXT-02);
 * - списки, вложенные списки (Tab / Shift+Tab), заголовки, списки дел (TXT-02);
 * - быстрая разметка `#`, `-`, `1.`, `[]` и `--` → `—` (TXT-03);
 * - меню блоков по «/» в начале строки или после пробела (TXT-04), в документе — ещё
 *   разделитель и ссылка на объект (TXT-06);
 * - вставка из других редакторов с базовым форматированием — модуль буфера Quill (TXT-08).
 * Escape или уход фокуса за пределы редактора завершают правку.
 */
export function RichTextEditor({
  type,
  text,
  style,
  camera,
  objectLabel,
  onEdit,
  onDone,
  onPickObject,
}: {
  type: string;
  text: Y.Text;
  style: CSSProperties;
  /** Вид камеры: панель и меню расставляются по экрану (BUG-012). */
  camera: CameraView;
  /** Подпись ссылки на объект; `null` — объекта нет. */
  objectLabel: (id: string) => string | null;
  /** Своя правка текста; `height` — нужная высота объекта под содержимое. */
  onEdit: (height: number) => void;
  onDone: () => void;
  /** TXT-06: выбрать объект доски для ссылки; `null` — выбор отменён. */
  onPickObject: (done: (id: string | null) => void) => void;
}) {
  const isDocument = type === "document";
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] =
    useState<EditorPlacement>(DEFAULT_PLACEMENT);
  const hostRef = useRef<HTMLDivElement>(null);
  const [quill, setQuill] = useState<Quill | null>(null);
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const [slash, setSlash] = useState<Slash | null>(null);
  const [link, setLink] = useState<{ range: Range; value: string } | null>(
    null,
  );
  /** Пока выбирают объект в диалоге, уход фокуса правку не завершает. */
  const holdRef = useRef(false);
  const slashRef = useRef<Slash | null>(null);
  const zoom = camera.zoom || 1;
  const latest = useRef({ onEdit, objectLabel, zoom });
  useEffect(() => {
    latest.current = { onEdit, objectLabel, zoom };
  });

  useEffect(() => {
    const host = hostRef.current;
    const wrapper = wrapperRef.current;
    if (host === null || wrapper === null) return;
    setObjectLabel((id) => latest.current.objectLabel(id) ?? "Missing object");
    const editor = createQuill(
      host,
      isDocument ? DOCUMENT_FORMATS : TEXT_FORMATS,
    );
    const root = editor.root;
    root.classList.add("rich-text");
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-multiline", "true");
    root.setAttribute("aria-label", "Object text");

    const unbind = bindQuill(editor, text, () => {
      latest.current.onEdit(contentHeight(wrapper, root));
    });

    const setMenu = (next: Slash | null) => {
      slashRef.current = next;
      setSlash(next);
    };
    const openSlash = (start: number) => {
      const bounds = editor.getBounds(start);
      const scale = latest.current.zoom;
      setMenu({
        start,
        query: "",
        active: 0,
        at: {
          left: host.offsetLeft + (bounds?.left ?? 0) / scale,
          top: host.offsetTop + (bounds?.top ?? 0) / scale,
          bottom: host.offsetTop + (bounds?.bottom ?? 0) / scale,
        },
      });
    };
    const trackSlash = () => {
      const current = slashRef.current;
      if (current === null) return;
      const range = editor.getSelection();
      if (
        range === null ||
        range.index <= current.start ||
        editor.getText(current.start, 1) !== "/"
      ) {
        setMenu(null);
        return;
      }
      const query = editor.getText(
        current.start + 1,
        range.index - current.start - 1,
      );
      if (
        query.includes("\n") ||
        slashMatches(query, isDocument).length === 0
      ) {
        setMenu(null);
      } else if (query !== current.query) {
        setMenu({ ...current, query, active: 0 });
      }
    };

    const onText = (delta: Delta, old: Delta, source: string) => {
      if (source !== "user") return;
      const ops = minimalChange(delta, old);
      if (applyShortcut(editor, ops)) return;
      const at = insertedAt(ops, "/");
      if (at !== null && slashRef.current === null && afterBreak(editor, at)) {
        openSlash(at);
      }
    };
    const onChange = () => {
      trackSlash();
      const range = editor.getSelection();
      setFormats(range === null ? {} : editor.getFormat(range));
    };
    editor.on("text-change", onText);
    editor.on("editor-change", onChange);

    editor.focus();
    editor.setSelection(0, editor.getLength() - 1, "silent");
    setQuill(editor);
    return () => {
      editor.off("text-change", onText);
      editor.off("editor-change", onChange);
      unbind();
      setQuill(null);
      host.innerHTML = "";
      host.className = "";
    };
  }, [text, isDocument]);

  const closeSlash = () => {
    slashRef.current = null;
    setSlash(null);
  };

  const matches = slash === null ? [] : slashMatches(slash.query, isDocument);

  // BUG-012: панель и меню — там, где их видно целиком; пересчёт при сдвиге вида,
  // смене поля, меню и панели.
  useLayoutEffect(() => {
    const field = wrapperRef.current;
    if (field === null) return;
    let caret = null;
    if (slash !== null) {
      const rect = field.getBoundingClientRect();
      caret = {
        left: rect.left + slash.at.left * zoom,
        right: rect.left + slash.at.left * zoom,
        top: rect.top + slash.at.top * zoom,
        bottom: rect.top + slash.at.bottom * zoom,
      };
    }
    const next = measurePlacement(
      field,
      toolbarRef.current,
      menuRef.current,
      caret,
    );
    setPlacement((current) =>
      current.toolbarBelow === next.toolbarBelow &&
      current.menuAbove === next.menuAbove &&
      Math.abs(current.menuShift - next.menuShift) < 1
        ? current
        : next,
    );
  }, [camera, style, slash, link, zoom]);

  function runSlash(id: string) {
    if (quill === null || slash === null) return;
    const { start, query } = slash;
    closeSlash();
    quill.deleteText(start, query.length + 1, "user");
    if (id === "object") {
      pickObject(start);
      return;
    }
    SLASH_COMMANDS.find((command) => command.id === id)?.apply(quill, start);
  }

  function pickObject(index: number) {
    if (quill === null) return;
    holdRef.current = true;
    onPickObject((id) => {
      holdRef.current = false;
      quill.focus();
      if (id === null) {
        quill.setSelection(index, 0, "user");
        return;
      }
      quill.insertEmbed(index, "objectLink", id, "user");
      quill.insertText(index + 1, " ", "user");
      quill.setSelection(index + 2, 0, "user");
    });
  }

  function toggleMark(format: string) {
    if (quill === null) return;
    quill.format(format, formats[format] !== true, "user");
  }

  function openLink() {
    if (quill === null) return;
    const range = quill.getSelection(true);
    const current = formats.link;
    setLink({
      range: linkRange(quill, range),
      value: typeof current === "string" ? current : "",
    });
  }

  function applyLink(href: string | false) {
    if (quill === null || link === null) return;
    const { range } = link;
    setLink(null);
    quill.focus();
    if (range.length > 0) {
      quill.formatText(range.index, range.length, "link", href, "user");
    } else if (href !== false && href.trim() !== "") {
      quill.insertText(range.index, href, "link", href, "user");
    }
    quill.setSelection(range.index + range.length, 0, "user");
  }

  function onKeyDownCapture(event: KeyboardEvent) {
    if (slash === null) return;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      handled();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const count = matches.length;
      const active = (slash.active + step + count) % count;
      slashRef.current = { ...slash, active };
      setSlash(slashRef.current);
    } else if (event.key === "Enter" || event.key === "Tab") {
      handled();
      const choice = matches[slash.active];
      if (choice !== undefined) runSlash(choice.id);
    } else if (event.key === "Escape") {
      handled();
      closeSlash();
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={`scene-object scene-${type} scene-editor rich-editor`}
      data-canvas-ignore=""
      style={style}
      onKeyDownCapture={onKeyDownCapture}
      onMouseDown={(event) => {
        // BUG-016: нажатие на поля объекта вокруг текста (у документа они широкие;
        // на телефоне сюда приходит и касание, создавшее документ) не уводит фокус.
        const target = event.target;
        if (
          target instanceof Node &&
          quill !== null &&
          !quill.root.contains(target) &&
          !(target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
      onBlur={(event) => {
        if (holdRef.current) return;
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onDone();
      }}
    >
      <div
        ref={toolbarRef}
        className={`rich-toolbar ui-panel${placement.toolbarBelow ? " rich-toolbar--below" : ""}`}
        role="toolbar"
        aria-label="Text formatting"
        onMouseDown={(event) => {
          // Кнопки не забирают фокус и выделение у поля.
          if (!(event.target instanceof HTMLInputElement))
            event.preventDefault();
        }}
      >
        {link === null ? (
          <>
            {MARKS.map((mark) => (
              <Button
                key={mark.format}
                variant="ghost"
                className={`rich-mark rich-mark--${mark.format}`}
                aria-label={mark.label}
                title={mark.label}
                aria-pressed={formats[mark.format] === true}
                aria-keyshortcuts={mark.keys || undefined}
                onClick={() => {
                  toggleMark(mark.format);
                }}
              >
                {mark.text}
              </Button>
            ))}
            <Button
              variant="ghost"
              aria-pressed={typeof formats.link === "string"}
              onClick={openLink}
            >
              Link
            </Button>
          </>
        ) : (
          <LinkForm
            value={link.value}
            onApply={applyLink}
            onCancel={() => {
              setLink(null);
              quill?.focus();
            }}
          />
        )}
      </div>
      <div ref={hostRef} />
      {slash !== null && matches.length > 0 && (
        <Menu
          label="Insert block"
          ref={menuRef}
          className={`rich-slash-menu${placement.menuAbove ? " rich-slash-menu--above" : ""}`}
          style={{
            left: slash.at.left + placement.menuShift / zoom,
            top: placement.menuAbove ? slash.at.top : slash.at.bottom,
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          {matches.map((item, i) => (
            <MenuItem
              key={item.id}
              data-active={i === slash.active ? "true" : undefined}
              onClick={() => {
                runSlash(item.id);
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

/** Поле адреса ссылки в панели редактора. */
function LinkForm({
  value,
  onApply,
  onCancel,
}: {
  value: string;
  onApply: (href: string | false) => void;
  onCancel: () => void;
}) {
  const [href, setHref] = useState(value);
  return (
    <form
      className="rich-link-form"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(href.trim() === "" ? false : href.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <TextField
        label="Link URL"
        type="url"
        value={href}
        autoFocus
        placeholder="https://"
        onChange={(event) => {
          setHref(event.target.value);
        }}
      />
      <Button type="submit" variant="primary">
        Apply
      </Button>
      {value !== "" && (
        <Button
          variant="ghost"
          onClick={() => {
            onApply(false);
          }}
        >
          Remove
        </Button>
      )}
    </form>
  );
}

/** Выделение или, если курсор внутри ссылки без выделения, вся ссылка. */
function linkRange(quill: Quill, range: Range): Range {
  if (range.length > 0) return range;
  const [blot] = quill.scroll.descendant(
    (node: { statics: { blotName: string } }) =>
      node.statics.blotName === "link",
    range.index,
  );
  if (blot === null) return range;
  return { index: quill.getIndex(blot), length: blot.length() };
}
