import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import type { DragData } from "./DragHandle";
import {
  collision,
  executeMove,
  IndicatorContext,
  targetOf,
  type Indicator,
} from "./dropTargets";
import { planMove, type Move } from "./folderTree";
import { errorMessage, FOLDER_CYCLE, type Folder } from "./libraryApi";

// Страница прокручивается во время перетаскивания (на телефоне список досок ниже
// дерева): цели измеряются заново, иначе их координаты устаревают.
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };
// Прокрутка только по вертикали и только у самого края: папки в верхней части
// экрана телефона остаются досягаемыми, а не уезжают вниз.
const AUTO_SCROLL = { threshold: { x: 0, y: 0.1 } };

/**
 * BRD-10: перетаскивание досок и папок в боковой список — порядок папок, вложение
 * папок и перенос досок. Работает мышью, пальцем и пером (Pointer Events).
 */
export function LibraryDnd({
  folders,
  onMoved,
  onError,
  children,
}: {
  folders: Folder[];
  onMoved: (move: Move) => void;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [active, setActive] = useState<DragData | null>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(null);

  function start(event: DragStartEvent) {
    setActive((event.active.data.current as DragData | undefined) ?? null);
  }

  function track(event: DragMoveEvent) {
    const target = targetOf(event);
    setIndicator(
      event.over && target
        ? {
            overId: String(event.over.id),
            zone: target.kind === "folder" ? target.zone : null,
          }
        : null,
    );
  }

  async function drop(event: DragEndEvent) {
    setActive(null);
    setIndicator(null);
    const drag = event.active.data.current as DragData | undefined;
    const target = targetOf(event);
    if (!drag || !target) return;
    const move = planMove(folders, drag.item, target);
    if (move === "cycle") onError(FOLDER_CYCLE);
    if (!move || move === "cycle") return;
    try {
      await executeMove(move);
      onMoved(move);
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={MEASURING}
      autoScroll={AUTO_SCROLL}
      onDragStart={start}
      onDragMove={track}
      onDragEnd={(event) => void drop(event)}
      onDragCancel={() => {
        setActive(null);
        setIndicator(null);
      }}
    >
      <IndicatorContext value={indicator}>{children}</IndicatorContext>
      <DragOverlay dropAnimation={null}>
        {active && <div className="library-drag-overlay">{active.title}</div>}
      </DragOverlay>
    </DndContext>
  );
}
