/**
 * TBL-06, TBL-07: обмен таблицей с внешними электронными таблицами через буфер обмена.
 * Наружу — текст с табуляцией (TSV) и HTML `<table>`: так копию принимают Excel, Google
 * Sheets, LibreOffice. Внутрь — TSV из буфера (кавычки Excel для ячеек с переводом строки
 * и табуляцией) или первая `<table>` из HTML.
 */

/** Больше строк и столбцов из чужих данных вставка не берёт. */
export const MAX_GRID_ROWS = 500;
export const MAX_GRID_COLUMNS = 100;

export type Grid = string[][];

/** Нужны ли ячейке кавычки в TSV. */
function needsQuotes(text: string): boolean {
  return /[\t\n\r"]/.test(text);
}

/** TBL-06: сетка как TSV — строки через перевод строки, ячейки через табуляцию. */
export function gridToTsv(grid: Grid): string {
  return grid
    .map((row) =>
      row
        .map((cell) =>
          needsQuotes(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
        )
        .join("\t"),
    )
    .join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** TBL-06: сетка как HTML-таблица; перевод строки в ячейке — `<br>`. */
export function gridToHtml(grid: Grid): string {
  const rows = grid
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table>${rows}</table>`;
}

/**
 * Разбор TSV: ячейка в кавычках может содержать табуляцию, перевод строки и `""`.
 * Завершающий перевод строки (Excel ставит его после последней строки) не даёт пустой
 * строки.
 */
export function parseTsv(text: string): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  const source = text.replace(/\r\n?/g, "\n");
  while (i < source.length) {
    const char = source[i] as string;
    if (char === '"' && cell === "") {
      // Ячейка в кавычках — до закрывающей кавычки, `""` — сама кавычка.
      let j = i + 1;
      let quoted = "";
      while (j < source.length) {
        const next = source[j] as string;
        if (next === '"') {
          if (source[j + 1] === '"') {
            quoted += '"';
            j += 2;
            continue;
          }
          break;
        }
        quoted += next;
        j++;
      }
      const after = source[j + 1];
      if (
        j < source.length &&
        (after === undefined || after === "\t" || after === "\n")
      ) {
        cell = quoted;
        i = j + 1;
        continue;
      }
      // Кавычка без пары — обычный символ.
    }
    if (char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
    i++;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Первая HTML-таблица буфера сеткой; объединённые ячейки повторяются пустыми. */
export function parseHtmlTable(html: string): Grid | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (table === null) return null;
  const grid: Grid = [];
  // Ячейки, занятые объединением строк сверху: номер строки → занятые столбцы.
  const taken = new Map<number, Set<number>>();
  [...table.rows].forEach((tr, r) => {
    const row: string[] = grid[r] ?? [];
    grid[r] = row;
    let c = 0;
    for (const td of [...tr.cells]) {
      while (taken.get(r)?.has(c) === true) c++;
      row[c] = cellText(td);
      const colSpan = Math.max(1, td.colSpan);
      const rowSpan = Math.max(1, td.rowSpan);
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          const set = taken.get(r + dr) ?? new Set<number>();
          set.add(c + dc);
          taken.set(r + dr, set);
          if (dr === 0) row[c + dc] = "";
        }
      }
      c += colSpan;
    }
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  const filled = grid.map((row) =>
    Array.from({ length: width }, (_, c) => row[c] ?? ""),
  );
  return filled.length > 0 && width > 0 ? filled : null;
}

/** Текст ячейки HTML: `<br>` и абзацы — переводы строки, пробелы схлопнуты. */
function cellText(cell: HTMLTableCellElement): string {
  const copy = cell.cloneNode(true) as HTMLElement;
  for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
  for (const block of copy.querySelectorAll("p, div")) {
    block.append("\n");
  }
  return copy.textContent
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * TBL-06: данные буфера — таблица? TSV (есть табуляция) или HTML с `<table>` — сетка,
 * иначе `null` (обычный текст). Размер ограничен.
 */
export function tabularGrid(text: string, html: string): Grid | null {
  let grid: Grid | null = null;
  if (text.includes("\t")) grid = parseTsv(text);
  else if (html !== "") grid = parseHtmlTable(html);
  if (grid === null) return null;
  const limited = grid
    .slice(0, MAX_GRID_ROWS)
    .map((row) => row.slice(0, MAX_GRID_COLUMNS));
  const width = Math.max(0, ...limited.map((row) => row.length));
  if (limited.length === 0 || width === 0) return null;
  return limited.map((row) =>
    Array.from({ length: width }, (_, c) => row[c] ?? ""),
  );
}
