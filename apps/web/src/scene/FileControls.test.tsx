import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileControls } from "./FileControls";

// BUG-035: Download во фрейме чужого сайта идёт через fetch, на своей странице — переходом.

const framed = vi.hoisted(() => ({ value: false }));
const download = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock("./frameDownload", () => ({
  isFramed: () => framed.value,
  downloadThroughFetch: download,
}));

const FILE = {
  name: "report.bin",
  rename: null,
  download: "/api/media/1?download=report.bin",
  extract: null,
};

describe("FileControls: Download", () => {
  // Отменил ли компонент переход; сам переход в jsdom не выполняется.
  let navigationCancelled: boolean | null = null;
  const record = (event: MouseEvent) => {
    navigationCancelled = event.defaultPrevented;
    event.preventDefault();
  };

  beforeEach(() => {
    navigationCancelled = null;
    window.addEventListener("click", record);
  });

  afterEach(() => {
    window.removeEventListener("click", record);
    framed.value = false;
    download.mockClear();
  });

  it("на своей странице — обычная ссылка скачивания", () => {
    render(<FileControls file={FILE} />);
    fireEvent.click(screen.getByRole("link", { name: "Download" }));
    expect(navigationCancelled).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  it("во фрейме — переход отменён, файл читается запросом под своим именем", () => {
    framed.value = true;
    render(<FileControls file={FILE} />);
    fireEvent.click(screen.getByRole("link", { name: "Download" }));
    expect(navigationCancelled).toBe(true);
    expect(download).toHaveBeenCalledWith(FILE.download, "report.bin");
  });
});
