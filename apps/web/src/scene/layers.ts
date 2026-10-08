/** CVS-18: команды порядка слоёв. */
export type LayerOp = "front" | "forward" | "backward" | "back";

interface Layered {
  id: string;
  z: number;
}

/**
 * CVS-17, CVS-18: новый порядок соседей (снизу вверх) после команды над выделенными.
 * Соседи — объекты одного родителя: верхнего уровня или одной группы.
 */
export function reorder<T extends Layered>(
  siblings: readonly T[],
  selected: ReadonlySet<string>,
  op: LayerOp,
): T[] {
  const isSelected = (item: T | undefined) =>
    item !== undefined && selected.has(item.id);
  const order = [...siblings];
  const swap = (i: number, j: number) => {
    const a = order[i] as T;
    order[i] = order[j] as T;
    order[j] = a;
  };
  switch (op) {
    case "front":
      return [
        ...order.filter((o) => !isSelected(o)),
        ...order.filter(isSelected),
      ];
    case "back":
      return [
        ...order.filter(isSelected),
        ...order.filter((o) => !isSelected(o)),
      ];
    case "forward":
      // Сверху вниз: каждый выделенный поднимается над одним невыделенным соседом.
      for (let i = order.length - 2; i >= 0; i--) {
        if (isSelected(order[i]) && !isSelected(order[i + 1])) swap(i, i + 1);
      }
      return order;
    case "backward":
      for (let i = 1; i < order.length; i++) {
        if (isSelected(order[i]) && !isSelected(order[i - 1])) swap(i - 1, i);
      }
      return order;
  }
}

/**
 * Целые `z` для порядка `order` (снизу вверх) с наименьшим числом изменений. Кандидаты:
 * прежние значения по возрастанию (перестановка соседей меняет только их), подъём
 * снизу и опускание сверху (наверх/вниз меняют только перенесённые). Возвращает только
 * изменившиеся `z`.
 */
export function renumber(order: readonly Layered[]): Map<string, number> {
  const current = order.map((o) => Math.round(o.z));
  const sorted = [...current].sort((a, b) => a - b);
  const up: number[] = [];
  for (const [i, z] of current.entries()) {
    const below = up[i - 1];
    up.push(below === undefined ? z : Math.max(z, below + 1));
  }
  const down: number[] = new Array<number>(current.length);
  for (let i = current.length - 1; i >= 0; i--) {
    const above = down[i + 1];
    const z = current[i] as number;
    down[i] = above === undefined ? z : Math.min(z, above - 1);
  }
  const distinct = sorted.every(
    (z, i) => i === 0 || z > (sorted[i - 1] as number),
  );
  const candidates = distinct ? [sorted, up, down] : [up, down];
  let best: Map<string, number> | null = null;
  for (const values of candidates) {
    const changes = new Map<string, number>();
    order.forEach((o, i) => {
      const z = values[i] as number;
      if (z !== o.z) changes.set(o.id, z);
    });
    if (best === null || changes.size < best.size) best = changes;
  }
  return best ?? new Map<string, number>();
}
