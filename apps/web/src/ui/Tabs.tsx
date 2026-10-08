import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

/**
 * UI-03: вкладки (роли tablist/tab/tabpanel). Стрелки, Home и End переводят фокус
 * и выбор между доступными вкладками.
 */
export function Tabs({
  label,
  tabs,
  selected,
  onSelect,
}: {
  label: string;
  tabs: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((tab) => !tab.disabled);
  const current = tabs.find((tab) => tab.id === selected);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((tab) => tab.id === selected);
    const last = enabled.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index >= last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index <= 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const target = next === null ? undefined : enabled[next];
    if (target === undefined) return;
    event.preventDefault();
    onSelect(target.id);
    list.current
      ?.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)
      ?.focus();
  }

  return (
    <div className="ui-tabs">
      <div
        ref={list}
        className="ui-tablist"
        role="tablist"
        aria-label={label}
        onKeyDown={keyDown}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="ui-tab"
            id={`${base}-tab-${tab.id}`}
            data-tab={tab.id}
            aria-selected={tab.id === selected}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => {
              onSelect(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current && (
        <div
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${current.id}`}
        >
          {current.content}
        </div>
      )}
    </div>
  );
}
