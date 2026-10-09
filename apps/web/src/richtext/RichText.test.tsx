import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RichText, type RichTextActions } from "./RichText";

function actions(over: Partial<RichTextActions> = {}): RichTextActions {
  return {
    onCheck: vi.fn(),
    onOpenObject: vi.fn(),
    objectLabel: (id) => (id === "known" ? "Sticky note: Idea" : null),
    ...over,
  };
}

describe("TXT-01, TXT-02, TXT-06: показ форматированного текста на холсте", () => {
  it("заголовок, начертание, ссылка в новой вкладке и списки", () => {
    const { container } = render(
      <RichText
        placeholder="Text"
        actions={actions()}
        ops={[
          { insert: "Title" },
          { insert: "\n", attributes: { header: 1 } },
          { insert: "bold", attributes: { bold: true } },
          { insert: " " },
          { insert: "site", attributes: { link: "https://example.org" } },
          { insert: "\n" },
          { insert: "one" },
          { insert: "\n", attributes: { list: "bullet" } },
          { insert: "nested" },
          { insert: "\n", attributes: { list: "ordered", indent: 1 } },
        ]}
      />,
    );
    expect(container.querySelector("h1")).toHaveTextContent("Title");
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("href", "https://example.org");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const items = container.querySelectorAll("ol > li");
    expect([...items].map((li) => li.getAttribute("data-list"))).toEqual([
      "bullet",
      "ordered",
    ]);
    expect(items[1]).toHaveClass("ql-indent-1");
  });

  it("TXT-02: пункт списка дел отмечается флажком без редактора — позиция его строки", async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    render(
      <RichText
        placeholder="Text"
        actions={actions({ onCheck })}
        ops={[
          { insert: "Milk" },
          { insert: "\n", attributes: { list: "unchecked" } },
          { insert: "Bread" },
          { insert: "\n", attributes: { list: "checked" } },
        ]}
      />,
    );
    const [milk, bread] = screen.getAllByRole("checkbox", { name: "Done" });
    expect(milk).not.toBeChecked();
    expect(bread).toBeChecked();
    await user.click(milk as HTMLElement);
    expect(onCheck).toHaveBeenCalledWith(4, true);
    await user.click(bread as HTMLElement);
    expect(onCheck).toHaveBeenCalledWith(10, false);
  });

  it("CVS-19: у заблокированного объекта флажки недоступны", () => {
    render(
      <RichText
        placeholder="Text"
        actions={actions({ onCheck: null })}
        ops={[
          { insert: "Milk" },
          { insert: "\n", attributes: { list: "unchecked" } },
        ]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeDisabled();
  });

  it("TXT-06: ссылка на объект ведёт к нему; удалённый объект — недоступная метка", async () => {
    const user = userEvent.setup();
    const onOpenObject = vi.fn();
    const { container } = render(
      <RichText
        placeholder="Document"
        actions={actions({ onOpenObject })}
        ops={[
          { insert: { objectLink: "known" } },
          { insert: " " },
          { insert: { objectLink: "gone" } },
          { insert: "\n" },
          { insert: { divider: true } },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sticky note: Idea" }));
    expect(onOpenObject).toHaveBeenCalledWith("known");
    expect(screen.getByRole("button", { name: "Missing object" })).toBeDisabled();
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("пустой текст — подсказка типа", () => {
    render(<RichText placeholder="Text" actions={actions()} ops={[]} />);
    expect(screen.getByText("Text")).toHaveClass("scene-placeholder");
  });
});
