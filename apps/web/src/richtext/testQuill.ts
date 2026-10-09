import { createQuill, TEXT_FORMATS, type Quill } from "./quill";

// jsdom не считает раскладку: Quill прокручивает к курсору по прямоугольнику диапазона.
Range.prototype.getBoundingClientRect = () => new DOMRect();
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;

/** Редактор Quill в документе jsdom для тестов. */
export function mountQuill(formats: readonly string[] = TEXT_FORMATS): Quill {
  const host = document.createElement("div");
  document.body.append(host);
  return createQuill(host, formats);
}

/** Набор текста «пользователем» посимвольно в позицию курсора. */
export function typeInto(quill: Quill, text: string): void {
  for (const char of text) {
    const index = quill.getSelection()?.index ?? quill.getLength() - 1;
    quill.insertText(index, char, "user");
    quill.setSelection(index + 1, 0, "silent");
  }
}
