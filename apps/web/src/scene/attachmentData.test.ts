import { describe, expect, it } from "vitest";
import {
  classifyFile,
  downloadUrl,
  formatSize,
  GENERIC_TYPE,
  readAttachment,
} from "./attachmentData";

const ID = "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f";

describe("classifyFile: каким объектом становится файл", () => {
  it.each([
    ["a.pdf", "application/pdf", "pdf"],
    ["a.mp4", "video/mp4", "video"],
    ["a.m4v", "video/x-m4v", "video"],
    ["a.mov", "video/quicktime", "video"],
    ["a.webm", "video/webm", "video"],
    ["a.mp3", "audio/mpeg", "audio"],
    ["a.m4a", "audio/x-m4a", "audio"],
    ["a.wav", "audio/wav", "audio"],
    ["a.webm", "audio/webm", "audio"],
  ])("FIL-02…FIL-04: %s (%s) — %s", (name, type, expected) => {
    expect(classifyFile({ name, type })).toEqual({
      type: expected,
      mime: type,
    });
  });

  it.each([
    ["a.PDF", "application/pdf", "pdf"],
    ["a.mp4", "video/mp4", "video"],
    ["a.m4v", "video/x-m4v", "video"],
    ["a.mov", "video/quicktime", "video"],
    ["a.webm", "video/webm", "video"],
    ["a.mp3", "audio/mpeg", "audio"],
    ["a.m4a", "audio/mp4", "audio"],
    ["a.wav", "audio/wav", "audio"],
  ])(
    "система не объявила тип: %s определяется по расширению",
    (name, mime, type) => {
      expect(classifyFile({ name, type: "" })).toEqual({ type, mime });
    },
  );

  it.each([
    ["report.docx", "application/msword"],
    ["page.html", "text/html"],
    ["data", ""],
    ["clip.avi", "video/x-msvideo"],
    ["photo.png", "image/png"],
  ])("FIL-01: %s — ярлык, тип не передаётся", (name, type) => {
    expect(classifyFile({ name, type })).toEqual({
      type: "file",
      mime: GENERIC_TYPE,
    });
  });
});

describe("downloadUrl: FIL-01", () => {
  it("адрес того же происхождения с именем на доске", () => {
    expect(downloadUrl(ID, "Отчёт итог.txt")).toBe(
      `/api/media/${ID}?download=%D0%9E%D1%82%D1%87%D1%91%D1%82+%D0%B8%D1%82%D0%BE%D0%B3.txt`,
    );
  });

  it("чужой адрес в документе не становится ссылкой", () => {
    expect(downloadUrl("https://evil.example/x", "x")).toBeNull();
  });
});

describe("formatSize", () => {
  it.each([
    [10, "10 B"],
    [2048, "2 KB"],
    [1536 * 1024, "1.5 MB"],
    [1024 ** 3, "1 GB"],
  ])("%d байт — %s", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe("readAttachment", () => {
  it("испорченная запись читается безопасно", () => {
    expect(
      readAttachment({ media: 5, name: null, size: "x", pages: -1, page: 0 }),
    ).toEqual({
      media: "",
      mime: "",
      name: "",
      size: 0,
      pages: 1,
      page: null,
    });
  });
});
