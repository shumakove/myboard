import { Button, Dialog, IconButton, Switch } from "../ui";
import { allTools, movePinned, togglePin } from "./pinnedTools";
import { keyLabel, toolById, toolTitle, type ToolId } from "./tools";

/**
 * CVS-24: полный список инструментов. Отсюда выбирают любой инструмент, закрепляют
 * его на левой панели или открепляют и меняют порядок закреплённых.
 */
export function ToolListDialog({
  tool,
  pinned,
  onTool,
  onPinned,
  onClose,
}: {
  tool: ToolId;
  pinned: readonly ToolId[];
  onTool: (tool: ToolId) => void;
  onPinned: (change: (pinned: readonly ToolId[]) => ToolId[]) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="All tools" onClose={onClose} className="tool-list-dialog">
      <ul className="tool-list" aria-label="All tools">
        {allTools(pinned).map((id) => {
          const item = toolById(id);
          const index = pinned.indexOf(id);
          const isPinned = index >= 0;
          return (
            <li key={id} className="tool-list-row">
              <Button
                variant="ghost"
                className="tool-list-name"
                aria-label={item.label}
                aria-pressed={tool === id}
                aria-keyshortcuts={keyLabel(item.key)}
                title={toolTitle(item)}
                onClick={() => {
                  onTool(id);
                  onClose();
                }}
              >
                {item.label}
                <kbd className="tool-key" aria-hidden="true">
                  {keyLabel(item.key)}
                </kbd>
              </Button>
              <Switch
                label="Pinned"
                aria-label={`Pin ${item.label}`}
                checked={isPinned}
                onChange={() => {
                  onPinned((current) => togglePin(current, id));
                }}
              />
              <IconButton
                label={`Move ${item.label} up`}
                disabled={!isPinned || index === 0}
                onClick={() => {
                  onPinned((current) => movePinned(current, id, -1));
                }}
              >
                ↑
              </IconButton>
              <IconButton
                label={`Move ${item.label} down`}
                disabled={!isPinned || index === pinned.length - 1}
                onClick={() => {
                  onPinned((current) => movePinned(current, id, 1));
                }}
              >
                ↓
              </IconButton>
            </li>
          );
        })}
      </ul>
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    </Dialog>
  );
}
