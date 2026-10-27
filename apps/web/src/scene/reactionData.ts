import type { SceneObject } from "./sceneObjects";

/**
 * Реакция-штамп (T6.11) в документе — `Y.Map` объекта `type: "reaction"`:
 * - `parent` — объект, на который её поставили; `x`, `y` — относительно него, поэтому
 *   реакция едет вместе с объектом (RCT-01) и уходит в корзину вместе с ним;
 * - `image` — изображение из набора (RCT-04);
 * - `width` = `height` — размер, до которого её вырастили удержанием (RCT-03);
 * - `createdBy` — кто поставил (CVS-22), показывается по наведению (RCT-02).
 */

export const REACTION_TYPE = "reaction";

export interface ReactionImage {
  /** Изображение — символ эмодзи. */
  value: string;
  label: string;
}

export interface ReactionSet {
  id: string;
  label: string;
  images: readonly ReactionImage[];
}

/** RCT-04: наборы изображений для реакций. */
export const REACTION_SETS: readonly ReactionSet[] = [
  {
    id: "emotions",
    label: "Emotions",
    images: [
      { value: "👍", label: "Thumbs up" },
      { value: "❤️", label: "Heart" },
      { value: "😂", label: "Laughing" },
      { value: "😮", label: "Surprised" },
      { value: "😢", label: "Sad" },
      { value: "😡", label: "Angry" },
      { value: "🎉", label: "Party" },
      { value: "👏", label: "Clapping" },
    ],
  },
  {
    id: "votes",
    label: "Votes",
    images: [
      { value: "✅", label: "Check" },
      { value: "❌", label: "Cross" },
      { value: "❓", label: "Question" },
      { value: "❗", label: "Exclamation" },
      { value: "⭐", label: "Star" },
      { value: "💯", label: "Hundred" },
      { value: "➕", label: "Plus" },
      { value: "➖", label: "Minus" },
    ],
  },
  {
    id: "stamps",
    label: "Stamps",
    images: [
      { value: "🔥", label: "Fire" },
      { value: "🚀", label: "Rocket" },
      { value: "💡", label: "Idea" },
      { value: "👀", label: "Eyes" },
      { value: "🏆", label: "Trophy" },
      { value: "🎯", label: "Target" },
      { value: "⚠️", label: "Warning" },
      { value: "🙏", label: "Thanks" },
    ],
  },
];

export const ALL_REACTIONS: readonly ReactionImage[] = REACTION_SETS.flatMap(
  (set) => set.images,
);

export const DEFAULT_REACTION = "👍";

/** Изображение из наборов; чужое значение — `null`. */
export function reactionImage(value: unknown): ReactionImage | null {
  return ALL_REACTIONS.find((image) => image.value === value) ?? null;
}

/** RCT-03: размер реакции — от начального до наибольшего, единицы доски. */
export const REACTION_MIN = 48;
export const REACTION_MAX = 240;
/** Рост за секунду удержания. */
const GROWTH_PER_SECOND = 160;
/** Удержание короче этого — обычный щелчок: реакция начального размера, мс. */
export const HOLD_DELAY = 250;

/** RCT-03: размер реакции после `elapsed` мс удержания. */
export function reactionSize(elapsed: number): number {
  const held = Math.max(0, elapsed - HOLD_DELAY);
  const grown = REACTION_MIN + (held / 1000) * GROWTH_PER_SECOND;
  return Math.min(REACTION_MAX, Math.round(grown));
}

export interface ReactionShape {
  image: string;
}

export function readReaction(
  record: Record<string, unknown>,
): ReactionShape | null {
  const image = reactionImage(record.image);
  return image === null ? null : { image: image.value };
}

/** RCT-02: подпись реакции — изображение и кто её поставил. */
export function reactionTitle(object: SceneObject): string {
  const label = reactionImage(object.reaction?.image)?.label ?? "Reaction";
  const author = object.meta.createdBy ?? "";
  return author === "" ? label : `${label} by ${author}`;
}
