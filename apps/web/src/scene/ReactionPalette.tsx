import { useState } from "react";
import { FloatingPanel, IconButton, Tabs } from "../ui";
import {
  REACTION_SETS,
  reactionImage,
  type ReactionImage,
} from "./reactionData";

/** Вкладка недавних реакций. */
const RECENT_TAB = "recent";

/**
 * RCT-04: наборы изображений у инструмента Reaction и недавно поставленные. Щелчок по
 * изображению выбирает реакцию, которую затем ставят нажатием на объект.
 */
export function ReactionPalette({
  current,
  recent,
  onPick,
}: {
  current: string;
  recent: readonly string[];
  onPick: (image: string) => void;
}) {
  const [tab, setTab] = useState(() =>
    recent.length > 0 ? RECENT_TAB : (REACTION_SETS[0]?.id ?? RECENT_TAB),
  );
  const recentImages = recent
    .map((value) => reactionImage(value))
    .filter((image) => image !== null);
  const grid = (images: readonly ReactionImage[]) => (
    <div className="reaction-grid">
      {images.length === 0 && (
        <span className="reaction-empty">
          Reactions you use will appear here.
        </span>
      )}
      {images.map((image) => (
        <IconButton
          key={image.value}
          label={`${image.label} reaction`}
          className="reaction-swatch"
          title={`${image.label}: click, then click an object to react.`}
          aria-pressed={image.value === current}
          onClick={() => {
            onPick(image.value);
          }}
        >
          <span aria-hidden="true">{image.value}</span>
        </IconButton>
      ))}
    </div>
  );
  return (
    <FloatingPanel
      className="reaction-palette"
      role="toolbar"
      aria-label="Reactions"
    >
      <Tabs
        label="Reaction sets"
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: RECENT_TAB, label: "Recent", content: grid(recentImages) },
          ...REACTION_SETS.map((set) => ({
            id: set.id,
            label: set.label,
            content: grid(set.images),
          })),
        ]}
      />
    </FloatingPanel>
  );
}
