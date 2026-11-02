import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import styles from "./admin.css?raw";
import type { User } from "./adminApi";
import { UserRow } from "./UserRow";

const LONG_NAME = `Anna ${"x".repeat(90)}`;
const USER: User = {
  id: "4d1f6a52-3c1e-4b7a-9d55-0a1b2c3d4e5f",
  name: LONG_NAME,
  email: "anna@example.com",
  disabled: false,
  created_at: "2026-11-02T10:00:00Z",
};

/** Объявления правила из `admin.css`; jsdom не считает раскладку и таблицу не измерит. */
function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return styles.slice(start, styles.indexOf("}", start));
}

describe("BUG-021, ADM-04, UI-04: длинное имя не растягивает страницу на телефоне", () => {
  it("имя в строке учётки — в переносимом элементе с ограниченной шириной", () => {
    render(
      <table>
        <tbody>
          <UserRow user={USER} onChange={vi.fn()} />
        </tbody>
      </table>,
    );
    expect(screen.getByText(LONG_NAME)).toHaveClass("admin-name");
    expect(rule(".admin-name")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".admin-name")).toMatch(/max-width:/);
  });

  it("колонка страницы не шире экрана: прокручивается таблица, а не страница", () => {
    expect(rule(".admin-page")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(rule(".admin-table-wrap")).toMatch(/overflow-x:\s*auto/);
  });
});
