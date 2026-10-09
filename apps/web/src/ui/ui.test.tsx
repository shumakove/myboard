import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  Dialog,
  FloatingPanel,
  IconButton,
  Menu,
  MenuItem,
  SelectField,
  Switch,
  Tabs,
  TextField,
  Tooltip,
} from ".";

describe("UI-03: кнопки", () => {
  it("вид кнопки задаётся вариантом; по умолчанию — второстепенная", () => {
    render(
      <>
        <Button variant="primary">Save</Button>
        <Button>Cancel</Button>
        <Button variant="danger">Delete</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "ui-button",
      "ui-button--primary",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "ui-button--secondary",
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "ui-button--danger",
    );
  });

  it("кнопка не отправляет форму, если тип не задан, и недоступная не нажимается", async () => {
    const submit = vi.fn((event: Event) => {
      event.preventDefault();
    });
    const click = vi.fn();
    render(
      <form
        onSubmit={(e) => {
          submit(e.nativeEvent);
        }}
      >
        <Button onClick={click}>Plain</Button>
        <Button disabled onClick={click}>
          Off
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plain" }));
    await userEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("кнопка-значок получает доступное имя из label", () => {
    render(<IconButton label="Zoom in">+</IconButton>);
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveClass(
      "ui-icon-button",
    );
  });
});

describe("UI-03: поля и переключатель", () => {
  it("подпись поля — его доступное имя", async () => {
    render(
      <>
        <TextField label="Email" defaultValue="" />
        <SelectField label="Grid" defaultValue="20">
          <option value="0">Off</option>
          <option value="20">20 px</option>
        </SelectField>
      </>,
    );
    const email = screen.getByRole("textbox", { name: "Email" });
    await userEvent.type(email, "a@b.c");
    expect(email).toHaveValue("a@b.c");
    expect(screen.getByRole("combobox", { name: "Grid" })).toHaveValue("20");
  });

  it("переключатель — роль switch, меняет состояние по нажатию", async () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <Switch
          label="Show grid"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
          }}
        />
      );
    }
    render(<Demo />);
    const toggle = screen.getByRole("switch", { name: "Show grid" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
  });
});

describe("UI-03: меню, диалог, подсказка, вкладки, панель", () => {
  it("меню и пункты меню имеют роли menu и menuitem", async () => {
    const pick = vi.fn();
    render(
      <Menu label="Board menu">
        <MenuItem onClick={pick}>Select all</MenuItem>
      </Menu>,
    );
    const menu = screen.getByRole("menu", { name: "Board menu" });
    expect(menu).toHaveClass("ui-menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Select all" }));
    expect(pick).toHaveBeenCalledOnce();
  });

  it("диалог назван заголовком и закрывается по Escape", async () => {
    const close = vi.fn();
    render(
      <Dialog title="Share board" onClose={close}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Share board" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
  });

  it("Escape закрывает диалог, даже если другой обработчик этой клавиши перерисовал страницу", () => {
    // В браузере между обработчиками одного нажатия выполняются микрозадачи: обработчик,
    // зарегистрированный раньше диалога, успевает перерисовать его родителя (T5.4).
    let rerender: () => void = () => undefined;
    const earlier = () => {
      flushSync(rerender);
    };
    window.addEventListener("keydown", earlier);
    function Page() {
      const [open, setOpen] = useState(true);
      const [, setTick] = useState(0);
      rerender = () => {
        setTick((n) => n + 1);
      };
      return open ? (
        <Dialog
          title="All tools"
          onClose={() => {
            setOpen(false);
          }}
        >
          <p>Body</p>
        </Dialog>
      ) : null;
    }
    render(<Page />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    window.removeEventListener("keydown", earlier);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("подсказка появляется при фокусе с клавиатуры и описывает элемент", async () => {
    render(
      <Tooltip text="Add a sticky note">
        {(describedBy) => (
          <button type="button" aria-describedby={describedBy}>
            Sticky
          </button>
        )}
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    await userEvent.tab();
    const button = screen.getByRole("button", { name: "Sticky" });
    expect(button).toHaveAccessibleDescription("Add a sticky note");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("вкладки переключаются нажатием и стрелками, недоступная пропускается", async () => {
    function Demo() {
      const [tab, setTab] = useState("a");
      return (
        <Tabs
          label="Sections"
          selected={tab}
          onSelect={setTab}
          tabs={[
            { id: "a", label: "First", content: "Panel A" },
            { id: "b", label: "Second", content: "Panel B", disabled: true },
            { id: "c", label: "Third", content: "Panel C" },
          ]}
        />
      );
    }
    render(<Demo />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel A");
    await userEvent.click(screen.getByRole("tab", { name: "First" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Third" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Third" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel C");
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel A");
  });

  it("плавающая панель сохраняет роль и имя, переданные экраном", () => {
    render(<FloatingPanel role="toolbar" aria-label="Tools" />);
    expect(screen.getByRole("toolbar", { name: "Tools" })).toHaveClass(
      "ui-panel",
    );
  });
});
