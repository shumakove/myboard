import { useState, type ReactNode } from "react";
import type { Point } from "../realtime/messages";
import type { ObjectType } from "./objectTypes";
import { ToolListDialog } from "./ToolListDialog";
import { keyLabel, toolById, toolTitle, type ToolId } from "./tools";
import { useDragToBoard } from "./useDragToBoard";
import { Button, FloatingPanel } from "../ui";

/**
 * Левая панель инструментов (CVS-09, CVS-10, CVS-24). На панели — закреплённые
 * инструменты в выбранном порядке, остальные — в полном списке (All tools). Инструмент
 * создания выбирается нажатием (затем щелчок по холсту ставит объект) или
 * перетаскивается с панели прямо на холст.
 */
export function ToolPanel({
  tool,
  pinned,
  onTool,
  onPinned,
  onDrop,
  children,
}: {
  tool: ToolId;
  /** Закреплённые инструменты в порядке панели. */
  pinned: readonly ToolId[];
  onTool: (tool: ToolId) => void;
  onPinned: (change: (pinned: readonly ToolId[]) => ToolId[]) => void;
  /** Кнопку инструмента отпустили над точкой экрана (координаты окна). */
  onDrop: (type: ObjectType, client: Point) => void;
  /** Действия доски после инструментов (в той же строке на телефоне). */
  children?: ReactNode;
}) {
  const [listOpen, setListOpen] = useState(false);
  const drag = useDragToBoard(onDrop);

  return (
    <>
      <FloatingPanel
        className="tool-panel"
        role="toolbar"
        aria-label="Tools"
        aria-orientation="vertical"
      >
        {pinned.map(toolById).map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            className="tool-button"
            aria-pressed={tool === item.id}
            aria-keyshortcuts={keyLabel(item.key)}
            title={toolTitle(item)}
            onClick={() => {
              // За отпусканием после перетаскивания приходит click — это не выбор.
              if (drag.consumeClick()) return;
              onTool(item.id);
            }}
            {...(item.kind === "create" && drag.handlers(item.id, item.label))}
          >
            {item.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="tool-button"
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          title="All tools: choose any tool, pin tools to this panel and change their order."
          onClick={() => {
            setListOpen(true);
          }}
        >
          All tools
        </Button>
        {children}
        {drag.ghost}
      </FloatingPanel>
      {/* Вне панели: в ней кнопки инструментов ищут по имени. */}
      {listOpen && (
        <ToolListDialog
          tool={tool}
          pinned={pinned}
          onTool={onTool}
          onPinned={onPinned}
          onClose={() => {
            setListOpen(false);
          }}
        />
      )}
    </>
  );
}
