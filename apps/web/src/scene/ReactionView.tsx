import { reactionTitle } from "./reactionData";
import type { SceneObject } from "./sceneObjects";

/**
 * RCT-01, RCT-03: реакция на объекте — изображение во весь свой размер; RCT-02: по
 * наведению — кто её поставил.
 */
export function ReactionView({ object }: { object: SceneObject }) {
  const size = Math.min(object.width, object.height);
  const image = object.reaction?.image ?? "";
  return (
    <>
      <span
        className="reaction-image"
        aria-hidden="true"
        style={{ fontSize: size * 0.8 }}
      >
        {image}
      </span>
      <span className="reaction-author" role="tooltip">
        {reactionTitle(object)}
      </span>
    </>
  );
}

/** RCT-03: реакция, которую растят удержанием, — до отпускания. */
export interface ReactionDraft {
  center: { x: number; y: number };
  size: number;
  image: string;
}

export function ReactionDraftView({ draft }: { draft: ReactionDraft | null }) {
  if (draft === null) return null;
  const { center, size, image } = draft;
  return (
    <div
      className="reaction-draft"
      data-testid="reaction-draft"
      data-size={size}
      aria-hidden="true"
      style={{
        left: center.x - size / 2,
        top: center.y - size / 2,
        width: size,
        height: size,
        fontSize: size * 0.8,
      }}
    >
      {image}
    </div>
  );
}
