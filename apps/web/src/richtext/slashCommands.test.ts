import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT_FORMATS } from "./quill";
import { SLASH_COMMANDS, slashMatches } from "./slashCommands";
import { mountQuill } from "./testQuill";

afterEach(() => {
  document.body.innerHTML = "";
});

function command(id: string) {
  const found = SLASH_COMMANDS.find((c) => c.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

describe("TXT-04: меню «/»", () => {
  it("в тексте — абзац, заголовки и списки; в документе — ещё разделитель и ссылка на объект", () => {
    const text = slashMatches("", false).map((c) => c.label);
    expect(text).toEqual([
      "Text",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bulleted list",
      "Numbered list",
      "To-do list",
    ]);
    const document = slashMatches("", true).map((c) => c.label);
    expect(document).toEqual([...text, "Divider", "Link to object"]);
  });

  it("набранное после «/» отбирает пункты по названию и словам", () => {
    expect(slashMatches("head", false).map((c) => c.id)).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
    expect(slashMatches("check", false).map((c) => c.id)).toEqual(["todo"]);
    expect(slashMatches("divider", false)).toEqual([]);
    expect(slashMatches("zzz", true)).toEqual([]);
  });

  it("пункт меняет вид строки: заголовок вместо списка и обратно в текст", () => {
    const quill = mountQuill();
    quill.insertText(0, "Line", "user");
    command("ordered").apply(quill, 0);
    expect(quill.getFormat(0, 1)).toEqual({ list: "ordered" });
    command("h2").apply(quill, 0);
    expect(quill.getFormat(0, 1)).toEqual({ header: 2 });
    command("text").apply(quill, 0);
    expect(quill.getFormat(0, 1)).toEqual({});
  });

  it("TXT-06: разделитель встаёт отдельным блоком документа", () => {
    const quill = mountQuill(DOCUMENT_FORMATS);
    quill.insertText(0, "Intro\n", "user");
    command("divider").apply(quill, 6);
    expect(quill.getContents().ops).toEqual([
      { insert: "Intro\n" },
      { insert: { divider: true } },
      { insert: "\n" },
    ]);
  });
});
