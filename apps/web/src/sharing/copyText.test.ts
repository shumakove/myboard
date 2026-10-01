import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";
import { stubCopyCommand } from "./fakeSharingServer";

function field(value: string) {
  const input = document.createElement("input");
  input.value = value;
  document.body.append(input);
  return input;
}

describe("copyText (SHR-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("в защищённом контексте пишет в Clipboard API", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    expect(await copyText("http://x/b/t", null)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("http://x/b/t");
  });

  it("по http копирует выделение поля", async () => {
    vi.stubGlobal("isSecureContext", false);
    const copyCommand = stubCopyCommand();
    const input = field("http://x/b/t");

    expect(await copyText("http://x/b/t", input)).toBe(true);
    expect(copyCommand).toHaveBeenCalledWith("copy");
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("отказ Clipboard API — пробует выделение", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    stubCopyCommand();

    expect(await copyText("t", field("t"))).toBe(true);
  });

  it("без поля и без Clipboard API — неудача", async () => {
    vi.stubGlobal("isSecureContext", false);

    expect(await copyText("t", null)).toBe(false);
  });
});
