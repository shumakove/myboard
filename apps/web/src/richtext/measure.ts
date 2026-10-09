/**
 * Высота объекта под его форматированный текст, единицы доски: высота содержимого
 * `content` плюс поля и рамка объекта `box`. Слой доски масштабируется CSS-преобразованием,
 * а `offsetHeight` его не учитывает — поэтому результат не зависит от масштаба вида.
 */
export function contentHeight(box: HTMLElement, content: HTMLElement): number {
  const style = getComputedStyle(box);
  const px = (value: string) => parseFloat(value || "0") || 0;
  return Math.ceil(
    content.offsetHeight +
      px(style.paddingTop) +
      px(style.paddingBottom) +
      px(style.borderTopWidth) +
      px(style.borderBottomWidth),
  );
}
