import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadThroughFetch, isFramed } from "./frameDownload";

// BUG-035: во фрейме чужого сайта файл скачивается запросом со страницы, а не переходом.

describe("isFramed", () => {
  it("страница верхнего уровня — не фрейм, вложенная — фрейм", () => {
    const top = {} as Window;
    expect(isFramed({ self: top, top } as unknown as Window)).toBe(false);
    expect(isFramed({ self: {}, top } as unknown as Window)).toBe(true);
  });

  it("недоступный `top` чужого источника — фрейм", () => {
    const view = {
      self: {},
      get top(): Window {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as Window;
    expect(isFramed(view)).toBe(true);
  });
});

describe("downloadThroughFetch", () => {
  // Адреса `blob:` на время теста подменяются, после — возвращаются как были.
  const NAMES = ["createObjectURL", "revokeObjectURL"] as const;
  const saved = NAMES.map((name) => Object.getOwnPropertyDescriptor(URL, name));

  afterEach(() => {
    NAMES.forEach((name, index) => {
      const descriptor = saved[index];
      if (descriptor === undefined) Reflect.deleteProperty(URL, name);
      else Object.defineProperty(URL, name, descriptor);
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubObjectUrls() {
    const create = vi.fn(() => "blob:file");
    const revoke = vi.fn();
    const define = (name: (typeof NAMES)[number], value: unknown) => {
      Object.defineProperty(URL, name, {
        value,
        configurable: true,
        writable: true,
      });
    };
    define("createObjectURL", create);
    define("revokeObjectURL", revoke);
    return { create, revoke };
  }

  it("файл читается с cookie страницы и сохраняется под именем ярлыка", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("data", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { create } = stubObjectUrls();
    const saved: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ href: this.href, download: this.download });
    });

    const url = "/api/media/1?download=report.bin";
    expect(await downloadThroughFetch(url, "report.bin")).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(url, { credentials: "same-origin" });
    expect(create).toHaveBeenCalledOnce();
    expect(saved).toEqual([{ href: "blob:file", download: "report.bin" }]);
    expect(document.querySelector('a[download="report.bin"]')).toBeNull();
  });

  it("отказ сервера — ничего не сохраняется", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 404 }))),
    );
    const { create } = stubObjectUrls();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    expect(await downloadThroughFetch("/api/media/1", "x.bin")).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
