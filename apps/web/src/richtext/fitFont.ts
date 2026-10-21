import { useLayoutEffect, type DependencyList, type RefObject } from "react";

/** STK-02: границы автоматического размера шрифта, единицы доски. */
export const MIN_FIT_FONT = 6;
export const MAX_FIT_FONT = 64;

/**
 * Наибольший целый размер шрифта из [min, max], при котором текст помещается
 * (`fits` монотонна: меньше шрифт — меньше текст). Ничего не помещается — `min`.
 */
export function fitFontSize(
  fits: (size: number) => boolean,
  min = MIN_FIT_FONT,
  max = MAX_FIT_FONT,
): number {
  let low = min;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * STK-02: подогнать размер шрифта объекта `box` под его текст (`.rich-text` внутри):
 * текст занимает высоту внутри полей объекта и не выходит за неё. Размер ставится
 * объекту — текст и его вложенные элементы наследуют его.
 */
export function fitBoxFont(box: HTMLElement): void {
  const content = box.querySelector<HTMLElement>(".rich-text");
  if (content === null) return;
  const style = getComputedStyle(box);
  const px = (value: string) => parseFloat(value || "0") || 0;
  const room =
    box.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
  const size = fitFontSize((candidate) => {
    box.style.fontSize = `${String(candidate)}px`;
    return content.offsetHeight <= room;
  });
  box.style.fontSize = `${String(size)}px`;
}

/**
 * STK-02: пока `enabled`, размер шрифта объекта в `ref` подгоняется под текст — при
 * отрисовке (`deps`), при изменении текста внутри (правка в поле, чужая правка) и при
 * изменении размера объекта.
 */
export function useFitFont(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  deps: DependencyList,
): void {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!enabled || box === null) return;
    const fit = () => {
      fitBoxFont(box);
    };
    fit();
    // Свой размер шрифта — атрибут style: наблюдатели его не видят, цикла нет.
    const mutations = new MutationObserver(fit);
    mutations.observe(box, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    resize?.observe(box);
    return () => {
      mutations.disconnect();
      resize?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- зависимости задаёт вызывающий
  }, [ref, enabled, ...deps]);
}
