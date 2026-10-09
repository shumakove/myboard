/**
 * BUG-012 (TXT-04, UI-01): панель оформления и меню «/» редактора лежат в слое доски и
 * не должны уходить за видимую часть холста или под панели интерфейса (вид, миникарта).
 * Здесь — выбор стороны по экранным прямоугольникам; измеряет их редактор.
 */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const GAP = 8;

/** Прямоугольник `box` виден целиком: внутри `area` и не пересекает препятствия. */
export function fits(box: Box, area: Box, obstacles: readonly Box[]): boolean {
  if (box.top < area.top || box.bottom > area.bottom) return false;
  return obstacles.every(
    (o) =>
      box.right <= o.left ||
      box.left >= o.right ||
      box.bottom <= o.top ||
      box.top >= o.bottom,
  );
}

/**
 * Панель над полем `field` высотой `height`, а если там её не видно — под полем.
 * Возвращает `true`, если панель ставится под поле.
 */
export function toolbarBelow(
  field: Box,
  size: { width: number; height: number },
  area: Box,
  obstacles: readonly Box[],
): boolean {
  const top = field.top - GAP - size.height;
  const above = {
    top,
    bottom: top + size.height,
    left: field.left,
    right: field.left + size.width,
  };
  if (fits(above, area, obstacles)) return false;
  const below = {
    top: field.bottom + GAP,
    bottom: field.bottom + GAP + size.height,
    left: field.left,
    right: field.left + size.width,
  };
  return fits(below, area, obstacles);
}

/**
 * Меню у курсора `caret`: под строкой, если там видно, иначе над ней; по горизонтали
 * сдвигается влево, чтобы не выйти за правый край. Возвращает сторону и сдвиг, px экрана.
 */
export function menuPlacement(
  caret: Box,
  size: { width: number; height: number },
  area: Box,
  obstacles: readonly Box[],
): { above: boolean; shift: number } {
  const shift = Math.min(0, area.right - GAP - (caret.left + size.width));
  const left = Math.max(area.left, caret.left + shift);
  const horizontal = { left, right: left + size.width };
  const below = {
    ...horizontal,
    top: caret.bottom,
    bottom: caret.bottom + size.height,
  };
  if (fits(below, area, obstacles))
    return { above: false, shift: left - caret.left };
  const above = {
    ...horizontal,
    top: caret.top - size.height,
    bottom: caret.top,
  };
  return {
    above:
      fits(above, area, obstacles) || caret.bottom + size.height > area.bottom,
    shift: left - caret.left,
  };
}

/** Где показать панель и меню редактора; меню — относительно курсора. */
export interface EditorPlacement {
  toolbarBelow: boolean;
  menuAbove: boolean;
  /** Сдвиг меню по горизонтали, px экрана. */
  menuShift: number;
}

export const DEFAULT_PLACEMENT: EditorPlacement = {
  toolbarBelow: false,
  menuAbove: false,
  menuShift: 0,
};

function box(rect: DOMRect): Box {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

/** Видимая часть холста: его прямоугольник внутри окна. */
function visibleArea(field: HTMLElement): Box {
  const canvas = field.closest(".board-canvas")?.getBoundingClientRect();
  return {
    top: Math.max(0, canvas?.top ?? 0),
    bottom: Math.min(window.innerHeight, canvas?.bottom ?? window.innerHeight),
    left: Math.max(0, canvas?.left ?? 0),
    right: Math.min(window.innerWidth, canvas?.right ?? window.innerWidth),
  };
}

/** Панели интерфейса и миникарта, кроме своих (внутри редактора) и его предков. */
function obstacles(field: HTMLElement): Box[] {
  return [...document.querySelectorAll<HTMLElement>(".ui-panel, .minimap")]
    .filter((panel) => !field.contains(panel) && !panel.contains(field))
    .map((panel) => panel.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(box);
}

/**
 * Расстановка для редактора `field` по экранным размерам панели и меню. `caret` —
 * строка курсора в px экрана (`null` — меню закрыто).
 */
export function measurePlacement(
  field: HTMLElement,
  toolbar: HTMLElement | null,
  menu: HTMLElement | null,
  caret: Box | null,
): EditorPlacement {
  const area = visibleArea(field);
  const blocks = obstacles(field);
  const size = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };
  const placement = { ...DEFAULT_PLACEMENT };
  if (toolbar !== null) {
    const rect = box(field.getBoundingClientRect());
    placement.toolbarBelow = toolbarBelow(rect, size(toolbar), area, blocks);
  }
  if (menu !== null && caret !== null) {
    const { above, shift } = menuPlacement(caret, size(menu), area, blocks);
    placement.menuAbove = above;
    placement.menuShift = shift;
  }
  return placement;
}
