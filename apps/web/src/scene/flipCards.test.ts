import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { copyObjects, pasteObjects } from "./clipboard";
import {
  createFlipCard,
  flipCards,
  setFlipFields,
  sideText,
} from "./flipCards";
import { readScene, writeFields, type SceneObject } from "./sceneObjects";
import { searchScene } from "./search";
import { linkedDocs } from "./testDocs";

// T6.11: флип-карточка — FLP-01…FLP-03.

function board() {
  return new Y.Doc().getMap<unknown>("objects");
}

function card(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error("нет карточки");
  return found;
}

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

describe("FLP-01: лицевая и оборотная сторона, картинка, направление", () => {
  it("новая карточка — две стороны, показана лицевая, переворот по горизонтали", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    const flip = card(objects, id).flip;
    expect(flip?.flipped).toBe(false);
    expect(flip?.direction).toBe("horizontal");
    expect(flip?.front).toMatchObject({
      text: "",
      fill: "#ffffff",
      image: null,
    });
    expect(flip?.back).toMatchObject({
      text: "",
      fill: "#81d4fa",
      image: null,
    });
  });

  it("текст каждой стороны свой; обе стороны ищутся (CVS-08)", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    sideText(objects, id, "front")?.insert(0, "Question");
    sideText(objects, id, "back")?.insert(0, "Answer");
    const flip = card(objects, id).flip;
    expect(flip?.front.text).toBe("Question");
    expect(flip?.back.text).toBe("Answer");
    expect(
      searchScene(readScene(objects), "answer").map((hit) => hit.object.id),
    ).toEqual([id]);
  });

  it("картинка — у своей стороны; не data URL изображения не принимается", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    setFlipFields(objects, card(objects, id), "back", { image: PIXEL }, "Bob");
    expect(card(objects, id).flip?.back.image).toBe(PIXEL);
    expect(card(objects, id).flip?.front.image).toBeNull();
    setFlipFields(
      objects,
      card(objects, id),
      "front",
      { image: "https://example.com/a.png" },
      "Bob",
    );
    expect(card(objects, id).flip?.front.image).toBeNull();
    setFlipFields(objects, card(objects, id), "back", { image: null }, "Bob");
    expect(card(objects, id).flip?.back.image).toBeNull();
  });

  it("направление переворота меняется на вертикальное", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    setFlipFields(
      objects,
      card(objects, id),
      "front",
      { direction: "vertical" },
      "Alice",
    );
    expect(card(objects, id).flip?.direction).toBe("vertical");
  });

  it("копия карточки — с обеими сторонами, текст оборота правится отдельно", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    sideText(objects, id, "back")?.insert(0, "Back");
    setFlipFields(objects, card(objects, id), "back", { image: PIXEL }, "A");
    const clip = copyObjects(objects, readScene(objects), [id]);
    if (clip === null) throw new Error("нет копии");
    const [copy] = pasteObjects(
      objects,
      clip,
      { kind: "at", point: { x: 500, y: 0 }, gridStep: 0 },
      "Bob",
    );
    if (copy === undefined) throw new Error("нет вставки");
    sideText(objects, copy, "back")?.insert(4, "!");
    expect(card(objects, copy).flip?.back).toMatchObject({
      text: "Back!",
      image: PIXEL,
    });
    expect(card(objects, id).flip?.back.text).toBe("Back");
  });
});

describe("FLP-02: переворот одной и всех выделенных карточек", () => {
  it("одна карточка показывает оборот и обратно", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    flipCards(objects, [card(objects, id)], "Bob");
    expect(card(objects, id).flip?.flipped).toBe(true);
    expect(card(objects, id).meta.updatedBy).toBe("Bob");
    flipCards(objects, [card(objects, id)], "Bob");
    expect(card(objects, id).flip?.flipped).toBe(false);
  });

  it("выделенные переворачиваются разом одной транзакцией; заблокированная — нет", () => {
    const objects = board();
    const ids = [0, 1, 2].map((i) =>
      createFlipCard(objects, { x: i * 300, y: 0 }, "Alice"),
    );
    writeFields(objects, new Map([[ids[2] ?? "", { locked: true }]]), "A");
    let transactions = 0;
    objects.doc?.on("afterTransaction", () => {
      transactions += 1;
    });
    flipCards(
      objects,
      ids.map((id) => card(objects, id)),
      "Alice",
    );
    expect(transactions).toBe(1);
    expect(ids.map((id) => card(objects, id).flip?.flipped)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("переворот виден второму участнику", () => {
    const [first, second] = linkedDocs();
    const a = first.getMap<unknown>("objects");
    const b = second.getMap<unknown>("objects");
    const id = createFlipCard(a, { x: 0, y: 0 }, "Alice");
    flipCards(a, [card(a, id)], "Alice");
    expect(card(b, id).flip?.flipped).toBe(true);
  });
});

describe("FLP-03: размер и форматирование текста на стороне", () => {
  it("у сторон свои размер, начертание, цвет, выравнивание и цвет стороны", () => {
    const objects = board();
    const id = createFlipCard(objects, { x: 0, y: 0 }, "Alice");
    setFlipFields(
      objects,
      card(objects, id),
      "back",
      {
        fontSize: 48,
        fontStyle: "bold-italic",
        color: "#ffffff",
        align: "left",
        fill: "#1f2937",
      },
      "Alice",
    );
    const flip = card(objects, id).flip;
    expect(flip?.back).toMatchObject({
      fontSize: 48,
      fontStyle: "bold-italic",
      color: "#ffffff",
      align: "left",
      fill: "#1f2937",
    });
    expect(flip?.front).toMatchObject({ fontSize: 24, fontStyle: "normal" });
  });

  it("одновременные правки разных свойств стороны сливаются", () => {
    const [first, second] = linkedDocs();
    const a = first.getMap<unknown>("objects");
    const b = second.getMap<unknown>("objects");
    const id = createFlipCard(a, { x: 0, y: 0 }, "Alice");
    setFlipFields(a, card(a, id), "front", { fontSize: 32 }, "Alice");
    setFlipFields(b, card(b, id), "front", { color: "#81d4fa" }, "Bob");
    expect(card(a, id).flip?.front).toMatchObject({
      fontSize: 32,
      color: "#81d4fa",
    });
  });
});
