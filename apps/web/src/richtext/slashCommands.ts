import type { Quill } from "./quill";

/**
 * TXT-04: меню вставки блока по «/». Команда применяется к строке, где набрали «/»:
 * текст «/запрос» удаляется, строка получает формат блока или после неё встаёт блок
 * документа. Разделитель и ссылка на объект — только в документе (TXT-06).
 */
export interface SlashCommand {
  id: string;
  label: string;
  /** Слова для отбора по набранному после «/». */
  keywords: string;
  documentOnly?: true;
  /** `index` — где стоял «/» (текст «/запрос» уже удалён). */
  apply: (quill: Quill, index: number) => void;
}

function lineFormat(name: string, value: unknown): SlashCommand["apply"] {
  return (quill, index) => {
    // Строка получает ровно один вид блока: заголовок или список.
    quill.formatLine(index, 0, { header: false, list: false }, "user");
    if (value !== false) quill.formatLine(index, 0, name, value, "user");
    quill.setSelection(index, 0, "user");
  };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    keywords: "text paragraph plain",
    apply: lineFormat("header", false),
  },
  {
    id: "h1",
    label: "Heading 1",
    keywords: "heading title h1",
    apply: lineFormat("header", 1),
  },
  {
    id: "h2",
    label: "Heading 2",
    keywords: "heading subtitle h2",
    apply: lineFormat("header", 2),
  },
  {
    id: "h3",
    label: "Heading 3",
    keywords: "heading h3",
    apply: lineFormat("header", 3),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    keywords: "bulleted list unordered",
    apply: lineFormat("list", "bullet"),
  },
  {
    id: "ordered",
    label: "Numbered list",
    keywords: "numbered list ordered",
    apply: lineFormat("list", "ordered"),
  },
  {
    id: "todo",
    label: "To-do list",
    keywords: "todo to-do checklist checkbox task",
    apply: lineFormat("list", "unchecked"),
  },
  {
    id: "divider",
    label: "Divider",
    keywords: "divider separator line hr",
    documentOnly: true,
    apply: (quill, index) => {
      // Разделитель — отдельным блоком; курсор — на строку после него.
      quill.insertEmbed(index, "divider", true, "user");
      quill.setSelection(index + 1, 0, "user");
    },
  },
];

/** Пункт «ссылка на объект»: выбор объекта открывает редактор (диалог). */
export const OBJECT_LINK_COMMAND = {
  id: "object",
  label: "Link to object",
  keywords: "link object board reference",
} as const;

/** Команды меню для типа объекта, отобранные по набранному после «/». */
export function slashMatches(
  query: string,
  isDocument: boolean,
): { id: string; label: string }[] {
  const needle = query.trim().toLowerCase();
  const all = [
    ...SLASH_COMMANDS.filter((c) => isDocument || c.documentOnly !== true),
    ...(isDocument ? [OBJECT_LINK_COMMAND] : []),
  ];
  return all
    .filter(
      (c) =>
        needle === "" ||
        c.label.toLowerCase().includes(needle) ||
        c.keywords.includes(needle),
    )
    .map(({ id, label }) => ({ id, label }));
}

/**
 * TXT-04: «/» в `index` открывает меню в начале строки или после пробела. Начало строки
 * считается по строке Quill: перед ней может стоять блок без текста (разделитель,
 * BUG-013), у которого `getText` пустой.
 */
export function afterBreak(quill: Quill, index: number): boolean {
  const [, offset] = quill.getLine(index);
  return offset === 0 || /\s/.test(quill.getText(index - 1, 1));
}
