/** Тип объекта-фрейма (T6.6, FRM-01…FRM-05). */
export const FRAME_TYPE = "frame";

/**
 * Настройки фрейма в документе (поля его `Y.Map`):
 * - `keepRatio` — FRM-03: размер меняется с сохранением пропорций;
 * - `contentHidden` — FRM-04: содержимое скрыто у всех участников;
 * - `lockContent` — FRM-05: блокировка фрейма распространяется на содержимое
 *   (`false` — заблокирована только рамка). Без поля — вместе с содержимым, как у группы.
 */
export interface FrameFields {
  keepRatio: boolean;
  contentHidden: boolean;
  lockContent: boolean;
}

/** Настройки фрейма на сцене: поля документа и вычисленная блокировка содержимого. */
export interface FrameOptions extends FrameFields {
  /** Объекты фрейма заблокированы вместе с ним (FRM-05) — новые в него не попадают. */
  contentLocked: boolean;
}

export function readFrameFields(record: Record<string, unknown>): FrameFields {
  return {
    keepRatio: record.keepRatio === true,
    contentHidden: record.contentHidden === true,
    lockContent: record.lockContent !== false,
  };
}
