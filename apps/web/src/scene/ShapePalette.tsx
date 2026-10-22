import { useState } from "react";
import type { Point } from "../realtime/messages";
import { SHAPE_KINDS, SHAPE_SETS, shapeKind, type ShapeSet } from "./shapes";
import { ShapePreview } from "./ShapeView";
import { useDragToBoard } from "./useDragToBoard";
import { FloatingPanel, IconButton, Tabs } from "../ui";

/**
 * SHP-01, SHP-02: наборы фигур у инструмента Shape — базовые, выноски, блок-схемы и BPMN.
 * Щелчок по образцу задаёт вид следующей фигуры (затем щелчок по холсту ставит её),
 * образец можно перетащить на холст — фигура встанет в точку отпускания.
 */
export function ShapePalette({
  kind,
  onKind,
  onDrop,
}: {
  kind: string;
  onKind: (kind: string) => void;
  /** Образец отпустили над точкой окна. */
  onDrop: (kind: string, client: Point) => void;
}) {
  const [set, setSet] = useState<ShapeSet>(() => shapeKind(kind).set);
  const drag = useDragToBoard(onDrop);
  return (
    <FloatingPanel className="shape-palette" role="toolbar" aria-label="Shapes">
      <Tabs
        label="Shape sets"
        selected={set}
        onSelect={(id) => {
          setSet(id as ShapeSet);
        }}
        tabs={SHAPE_SETS.map((item) => ({
          id: item.id,
          label: item.label,
          content: (
            <div className="shape-grid">
              {SHAPE_KINDS.filter((k) => k.set === item.id).map((k) => (
                <IconButton
                  key={k.id}
                  label={k.label}
                  className="shape-swatch"
                  title={`${k.label}: click to use for new shapes or drag onto the board.`}
                  aria-pressed={k.id === kind}
                  onClick={() => {
                    if (!drag.consumeClick()) onKind(k.id);
                  }}
                  {...drag.handlers(k.id, k.label)}
                >
                  <ShapePreview kind={k} />
                </IconButton>
              ))}
            </div>
          ),
        }))}
      />
      {drag.ghost}
    </FloatingPanel>
  );
}
