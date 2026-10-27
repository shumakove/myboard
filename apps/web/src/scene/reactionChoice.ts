import { useCallback, useState } from "react";
import { DEFAULT_REACTION, reactionImage } from "./reactionData";

/**
 * RCT-04: выбранная реакция и недавно использованные. Хранит браузер (`localStorage`):
 * выбор общий для всех досок этого браузера и переживает закрытие вкладки, как недавние
 * цвета (SHP-04).
 */
export const REACTIONS_KEY = "myboard.reactions";

/** Сколько недавних реакций хранится. */
export const RECENT_REACTIONS_LIMIT = 8;

export interface ReactionChoice {
  /** Изображение следующей реакции. */
  current: string;
  /** Недавно поставленные, последняя — первой. */
  recent: string[];
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Сохранённый выбор; испорченная запись и чужие изображения отбрасываются. */
export function loadReactionChoice(): ReactionChoice {
  const choice: ReactionChoice = { current: DEFAULT_REACTION, recent: [] };
  try {
    const raw = storage()?.getItem(REACTIONS_KEY);
    if (raw == null) return choice;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return choice;
    const { current, recent } = data as Record<string, unknown>;
    const image = reactionImage(current);
    if (image !== null) choice.current = image.value;
    if (Array.isArray(recent)) {
      const known = recent
        .map((value) => reactionImage(value)?.value ?? null)
        .filter((value) => value !== null);
      choice.recent = [...new Set(known)].slice(0, RECENT_REACTIONS_LIMIT);
    }
  } catch {
    // Испорченная запись — выбор по умолчанию.
  }
  return choice;
}

function save(choice: ReactionChoice): void {
  try {
    storage()?.setItem(REACTIONS_KEY, JSON.stringify(choice));
  } catch {
    // Хранилище недоступно (приватный режим): выбор живёт до перезагрузки.
  }
}

/** Реакция поставлена — она первая в недавних. */
export function withRecent(
  choice: ReactionChoice,
  image: string,
): ReactionChoice {
  return {
    ...choice,
    recent: [image, ...choice.recent.filter((value) => value !== image)].slice(
      0,
      RECENT_REACTIONS_LIMIT,
    ),
  };
}

/** Выбор реакции вкладки: смена изображения и отметка использованного. */
export function useReactionChoice(): {
  choice: ReactionChoice;
  pick: (image: string) => void;
  used: (image: string) => void;
} {
  const [choice, setChoice] = useState(loadReactionChoice);
  const update = useCallback((next: (c: ReactionChoice) => ReactionChoice) => {
    setChoice((current) => {
      const value = next(current);
      save(value);
      return value;
    });
  }, []);
  const pick = useCallback(
    (image: string) => {
      update((current) => ({ ...current, current: image }));
    },
    [update],
  );
  const used = useCallback(
    (image: string) => {
      update((current) => withRecent(current, image));
    },
    [update],
  );
  return { choice, pick, used };
}
