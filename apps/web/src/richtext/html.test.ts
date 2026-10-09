import { describe, expect, it } from "vitest";
import { deltaToHtml, htmlToDelta } from "./html";

describe("TXT-07: копия во внешний редактор — HTML с форматированием", () => {
  it("заголовок, абзац с начертанием и ссылкой, экранирование", () => {
    const html = deltaToHtml([
      { insert: "Plan" },
      { insert: "\n", attributes: { header: 2 } },
      { insert: "a<b " },
      { insert: "bold", attributes: { bold: true } },
      { insert: " " },
      { insert: "site", attributes: { link: "https://x.org/?a=1&b=2" } },
      { insert: "\n" },
    ]);
    expect(html).toBe(
      '<h2>Plan</h2><p>a&lt;b <strong>bold</strong> <a href="https://x.org/?a=1&amp;b=2">site</a></p>',
    );
  });

  it("вложенные списки — вложенные ul/ol; список дел — маркированный с ☐/☑", () => {
    const html = deltaToHtml([
      { insert: "one" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "inner" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
      { insert: "two" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "done" },
      { insert: "\n", attributes: { list: "checked" } },
    ]);
    expect(html).toBe(
      "<ul><li>one<ul><li>inner</li></ul></li></ul><ol><li>two</li></ol><ul><li>☑ done</li></ul>",
    );
  });

  it("разделитель и ссылка на объект документа — hr и подпись объекта", () => {
    const html = deltaToHtml(
      [
        { insert: "See " },
        { insert: { objectLink: "id1" } },
        { insert: "\n" },
        { insert: { divider: true } },
      ],
      () => "Sticky note: Idea",
    );
    expect(html).toBe("<p>See Sticky note: Idea</p><hr>");
  });
});

describe("TXT-08: вставка из внешнего документа — базовое форматирование", () => {
  it("заголовки, начертание, ссылки и вложенные списки сохраняются", () => {
    const delta = htmlToDelta(
      '<h1>Title</h1><p><b>B</b><i>I</i><u>U</u><s>S</s> <a href="https://e.org">L</a></p><ul><li>one<ul><li>two</li></ul></li></ul>',
    );
    expect(delta).toEqual([
      { insert: "Title" },
      { insert: "\n", attributes: { header: 1 } },
      { insert: "B", attributes: { bold: true } },
      { insert: "I", attributes: { italic: true } },
      { insert: "U", attributes: { underline: true } },
      { insert: "S", attributes: { strike: true } },
      { insert: " " },
      { insert: "L", attributes: { link: "https://e.org" } },
      { insert: "\n" },
      { insert: "one" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "two" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
    ]);
  });

  it("стили Google Docs (жирный через font-weight) понимаются, чужие цвета и шрифты — нет", () => {
    const delta = htmlToDelta(
      '<p><span style="font-weight:700;color:#ff0000;font-family:Arial">Heavy</span> text</p>',
    );
    expect(delta).toEqual([
      { insert: "Heavy", attributes: { bold: true } },
      { insert: " text" },
    ]);
  });

  it("в тексте разделителя нет — он только в документе (TXT-06)", () => {
    expect(htmlToDelta("<p>a</p><hr><p>b</p>", "text")).not.toContainEqual({
      insert: { divider: true },
    });
    expect(htmlToDelta("<p>a</p><hr><p>b</p>", "document")).toContainEqual({
      insert: { divider: true },
    });
  });
});
