import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { isRich, parseDelta, plainText, safeLink, toBlocks } from "./delta";

describe("TXT-02, TXT-06: строки и блоки форматированного текста", () => {
  it("заголовки, списки с вложенностью, отметки дел и позиции переводов строк", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "Title\nMilk\nBread\nEggs\nend");
    text.format(5, 1, { header: 1 });
    text.format(10, 1, { list: "checked" });
    text.format(16, 1, { list: "bullet", indent: 1 });
    text.format(21, 1, { list: "ordered" });

    const blocks = toBlocks(text.toDelta());
    expect(blocks).toEqual([
      expect.objectContaining({ kind: "line", header: 1, list: null, end: 5 }),
      expect.objectContaining({ list: "checked", indent: 0, end: 10 }),
      expect.objectContaining({ list: "bullet", indent: 1, end: 16 }),
      expect.objectContaining({ list: "ordered", end: 21 }),
      expect.objectContaining({ list: null, header: 0, end: null }),
    ]);
  });

  it("начертание и ссылки; небезопасная ссылка отбрасывается", () => {
    const blocks = toBlocks([
      { insert: "bold", attributes: { bold: true, italic: true } },
      { insert: "site", attributes: { link: "https://example.org" } },
      { insert: "evil", attributes: { link: "javascript:alert(1)" } },
      { insert: "\n" },
    ]);
    const [line] = blocks;
    expect(line?.kind === "line" && line.inlines).toEqual([
      { kind: "text", text: "bold", marks: { bold: true, italic: true } },
      { kind: "text", text: "site", marks: { link: "https://example.org" } },
      { kind: "text", text: "evil", marks: {} },
    ]);
  });

  it("разделитель и ссылка на объект — блоки документа", () => {
    const blocks = toBlocks([
      { insert: "Intro\n" },
      { insert: { divider: true } },
      { insert: "See " },
      { insert: { objectLink: "abc" } },
      { insert: "\n" },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["line", "divider", "line"]);
    expect(blocks[1]).toEqual({ kind: "divider", index: 6 });
    const last = blocks[2];
    expect(last?.kind === "line" && last.inlines[1]).toEqual({
      kind: "object",
      id: "abc",
      marks: {},
    });
    expect(
      plainText(
        [{ insert: "See " }, { insert: { objectLink: "abc" } }],
        (id) => `[${id}]`,
      ),
    ).toBe("See [abc]");
  });

  it("испорченные атрибуты не ломают показ: неизвестный список и уровень", () => {
    const [line] = toBlocks([
      { insert: "x" },
      { insert: "\n", attributes: { list: "<b>", indent: 99, header: 6 } },
    ]);
    expect(line).toMatchObject({ list: null, indent: 8, header: 3 });
  });

  it("safeLink пропускает http(s), mailto, tel", () => {
    expect(safeLink("https://a.b")).toBe("https://a.b");
    expect(safeLink("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeLink("data:text/html,x")).toBeNull();
    expect(safeLink(42)).toBeNull();
  });

  it("isRich отличает форматирование от простого текста; parseDelta проверяет чужие данные", () => {
    expect(isRich([{ insert: "plain\n" }])).toBe(false);
    expect(isRich([{ insert: "b", attributes: { bold: true } }])).toBe(true);
    expect(parseDelta([{ insert: "a" }, { insert: { divider: true } }])).toEqual([
      { insert: "a" },
      { insert: { divider: true } },
    ]);
    expect(parseDelta([{ insert: { script: "x" } }])).toBeNull();
    expect(parseDelta("text")).toBeNull();
  });
});
