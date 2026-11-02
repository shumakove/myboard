import { describe, expect, it } from "vitest";
import {
  hostOf,
  parseIframeCode,
  readEmbed,
  readLinkCard,
  readObjectLink,
  resolveLink,
  typedUrl,
  webUrl,
} from "./embedData";

describe("EMB-01: разбор кода iframe", () => {
  it("берёт адрес и размер", () => {
    expect(
      parseIframeCode(
        '  <iframe width="800" height="450px" src="https://video.test/e/1" frameborder="0" allowfullscreen></iframe>\n',
      ),
    ).toEqual({ src: "https://video.test/e/1", width: 800, height: 450 });
  });

  it("размер в процентах не читается, чрезмерный — ограничивается", () => {
    expect(
      parseIframeCode(
        '<iframe src="http://a.test" width="100%" height="99999"></iframe>',
      ),
    ).toEqual({ src: "http://a.test/", width: null, height: 1600 });
  });

  it.each([
    ["обычный текст", "hello"],
    ["только адрес", "https://a.test"],
    ["другой элемент", '<img src="https://a.test/x.png">'],
    ["без адреса", "<iframe></iframe>"],
    ["javascript", '<iframe src="javascript:alert(1)"></iframe>'],
    ["data", '<iframe src="data:text/html,<script>1</script>"></iframe>'],
    ["относительный адрес", '<iframe src="/boards"></iframe>'],
    [
      "два фрейма",
      '<iframe src="https://a.test"></iframe><iframe src="https://b.test"></iframe>',
    ],
    ["код с лишним текстом", '<iframe src="https://a.test"></iframe> tail'],
    [
      "код со скриптом",
      '<iframe src="https://a.test"></iframe><script>1</script>',
    ],
  ])("%s — не код iframe", (_name, code) => {
    expect(parseIframeCode(code)).toBeNull();
  });

  it("атрибуты-обработчики из кода не попадают в объект", () => {
    expect(
      parseIframeCode(
        '<iframe src="https://a.test" onload="alert(1)"></iframe>',
      ),
    ).toEqual({ src: "https://a.test/", width: null, height: null });
  });
});

describe("адреса из документа проверяются при чтении", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "",
    7,
    null,
  ])("%s не становится адресом", (value) => {
    expect(webUrl(value)).toBeNull();
    expect(readEmbed({ src: value }).src).toBeNull();
    expect(readLinkCard({ url: value }).url).toBeNull();
    expect(readObjectLink({ link: value })).toBeNull();
  });

  it("EMB-03: ссылка на объект важнее адреса", () => {
    expect(readObjectLink({ linkObject: "a", link: "https://a.test" })).toEqual(
      { kind: "object", id: "a" },
    );
    expect(readObjectLink({ link: "https://a.test" })).toEqual({
      kind: "url",
      url: "https://a.test/",
    });
    expect(readObjectLink({})).toBeNull();
  });

  it("EMB-02: карточка без файла", () => {
    expect(readLinkCard({ url: "https://a.test" })).toEqual({
      url: "https://a.test/",
      media: null,
    });
  });
});

describe("адрес из поля ввода", () => {
  it("без схемы — https", () => {
    expect(typedUrl(" example.com/a ")).toBe("https://example.com/a");
  });

  it("другая схема и пусто — отказ", () => {
    expect(typedUrl("javascript:alert(1)")).toBeNull();
    expect(typedUrl("mailto:a@b.c")).toBeNull();
    expect(typedUrl("   ")).toBeNull();
    expect(typedUrl("http://")).toBeNull();
  });

  it("подпись — хост с портом", () => {
    expect(hostOf("http://192.168.1.20:8080/a")).toBe("192.168.1.20:8080");
  });
});

describe("EMB-03: что ввёл участник", () => {
  const origin = "http://192.168.1.20:8080";
  const here = (id: string) => id === "obj-1";

  it("ссылка SHR-07 на объект этой доски — переход к объекту", () => {
    expect(resolveLink(`${origin}/b/tok?object=obj-1`, here, origin)).toEqual({
      kind: "object",
      id: "obj-1",
    });
  });

  it("объект другой доски и другой сайт — обычный адрес", () => {
    expect(resolveLink(`${origin}/b/other?object=obj-9`, here, origin)).toEqual(
      { kind: "url", url: `${origin}/b/other?object=obj-9` },
    );
    expect(resolveLink("https://a.test/?object=obj-1", here, origin)).toEqual({
      kind: "url",
      url: "https://a.test/?object=obj-1",
    });
  });

  it("негодный адрес — отказ", () => {
    expect(resolveLink("javascript:alert(1)", here, origin)).toBeNull();
  });
});
