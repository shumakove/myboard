import Quill from "quill/core";
import { BlockEmbed } from "quill/blots/block";
import Embed from "quill/blots/embed";
import Bold from "quill/formats/bold";
import Header from "quill/formats/header";
import Indent from "quill/formats/indent";
import Italic from "quill/formats/italic";
import Link from "quill/formats/link";
import ListItem, { ListContainer } from "quill/formats/list";
import Strike from "quill/formats/strike";
import Underline from "quill/formats/underline";

/**
 * Редактор форматированного текста — Quill поверх обычного поля `contenteditable`
 * браузера (ARCHITECTURE.md, раздел 4; решение — docs/decisions.md, T6.1). Здесь
 * регистрируются только нужные форматы: всё прочее при вставке отбрасывается (TXT-08).
 */

/** TXT-06: разделитель документа — отдельный блок. */
class DividerBlot extends BlockEmbed {
  static override blotName = "divider";
  static override tagName = "HR";
}

/** Подпись ссылки на объект в редакторе; задаёт редактор доски (знает объекты). */
let objectLabel: (id: string) => string = () => "Object";

export function setObjectLabel(label: (id: string) => string): void {
  objectLabel = label;
}

/** TXT-06: ссылка на объект этой доски — вставка с id объекта. */
class ObjectLinkBlot extends Embed {
  static override blotName = "objectLink";
  static override tagName = "SPAN";
  static override className = "rt-object-link";

  static override create(value: unknown): HTMLElement {
    const node = super.create(value) as HTMLElement;
    const id = typeof value === "string" ? value : "";
    node.setAttribute("data-object", id);
    node.textContent = objectLabel(id);
    return node;
  }

  static override value(node: HTMLElement): string {
    return node.getAttribute("data-object") ?? "";
  }
}

Quill.register(
  {
    "formats/bold": Bold,
    "formats/italic": Italic,
    "formats/underline": Underline,
    "formats/strike": Strike,
    "formats/link": Link,
    "formats/header": Header,
    "formats/list": ListItem,
    "formats/list-container": ListContainer,
    "formats/indent": Indent,
    "formats/divider": DividerBlot,
    "formats/objectLink": ObjectLinkBlot,
  },
  true,
);

/** Форматы символов: сбрасываются явно у чужих вставок (иначе Quill их унаследует). */
export const INLINE_FORMATS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "link",
] as const;

/** TXT-02: форматы текстового блока. */
export const TEXT_FORMATS: readonly string[] = [
  ...INLINE_FORMATS,
  "header",
  "list",
  "indent",
];

/** TXT-06: документ — те же форматы плюс разделитель и ссылки на объекты. */
export const DOCUMENT_FORMATS: readonly string[] = [
  ...TEXT_FORMATS,
  "divider",
  "objectLink",
];

/**
 * Новый редактор в `container`. Встроенная автозамена списков Quill выключена: быструю
 * разметку (TXT-03) применяет `shortcuts.ts` по уже введённому тексту — так она работает
 * и с экранной клавиатуры телефона, где нет нажатий клавиш.
 */
export function createQuill(
  container: HTMLElement,
  formats: readonly string[],
): Quill {
  return new Quill(container, {
    formats: [...formats],
    modules: {
      // Отмена в поле — только своих правок; чужие правки её не трогают (COL-01).
      history: { userOnly: true },
      keyboard: { bindings: { "list autofill": false } },
    },
  });
}

export { Quill };
