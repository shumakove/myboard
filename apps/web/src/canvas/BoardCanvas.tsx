import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { CameraView, Point } from "../realtime/messages";
import { edgeVelocity } from "../scene/geometry";
import type { Gesture } from "../scene/gestures";
import { panBy, pinch, screenToBoard, zoomAt, type Size } from "./camera";
import { wheelAction, type WheelMode } from "./wheel";
import "./canvas.css";

/** MOB-03: столько держат палец, чтобы началось выделение, мс. */
export const LONG_PRESS_MS = 500;
/** Сдвиг указателя, после которого нажатие уже не щелчок и не долгое нажатие, px. */
const TAP_TOLERANCE = { mouse: 4, other: 10 };
/** CVS-13: шаг автопрокрутки, мс (~60 раз в секунду). */
const AUTOSCROLL_TICK_MS = 16;
/** Точки сетки не рисуются чаще, чем через столько экранных px. */
const MIN_DOT_SPACING = 8;

export type CameraUpdate = (camera: CameraView) => CameraView;

/** Нажатие на холсте: точка доски и экрана, элемент под указателем, модификаторы. */
export interface CanvasPress {
  board: Point;
  screen: Point;
  target: EventTarget | null;
  pointerType: string;
  shiftKey: boolean;
  altKey: boolean;
}

/** Что делают нажатия на холсте (инструменты сцены, T5.2). */
export interface CanvasGestures {
  /**
   * Начало жеста. `null` — жеста нет, нажатие двигает вид. Касание пальцем сначала
   * приходит с `longPress = false`, а если палец держат на месте — ещё раз с `true` (MOB-03).
   */
  start(press: CanvasPress, longPress: boolean): Gesture | null;
  /** Нажатие без движения, которое не начало жест (щелчок, касание). */
  tap(press: CanvasPress): void;
  contextMenu(press: CanvasPress): void;
  doubleClick(press: CanvasPress): void;
}

interface Session {
  pointerId: number;
  press: CanvasPress;
  gesture: Gesture | null;
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  last: Point;
  modifiers: { shiftKey: boolean; altKey: boolean };
}

/**
 * Область холста с камерой над бесконечной плоскостью (CVS-01). Дочерние элементы
 * рисуются в координатах доски в слое с CSS-преобразованием камеры.
 *
 * - CVS-02, CVS-03: колесо масштабирует или сдвигает вид по выбранному режиму;
 *   перетаскивание, не занятое инструментом, и средняя кнопка мыши сдвигают вид.
 * - CVS-06: фон и сетка с шагом из настроек доски.
 * - CVS-13: пока объект тянут у края, вид прокручивается.
 * - MOB-02: один палец двигает вид, два — щипок (масштаб и сдвиг одновременно).
 * - MOB-03: короткое движение пальцем двигает вид, долгое нажатие начинает выделение.
 * - COL-02: положение указателя уходит наверх в координатах доски; во время щипка
 *   курсор не прыгает между пальцами.
 */
export function BoardCanvas({
  camera,
  wheelMode,
  background = "#fafafa",
  dotColor = "#c8c8c8",
  gridStep = 32,
  gestures,
  canvasRef,
  onMove,
  onPointer,
  onResize,
  children,
}: {
  camera: CameraView;
  wheelMode: WheelMode;
  background?: string;
  dotColor?: string;
  /** Шаг сетки в единицах доски, 0 — без сетки. */
  gridStep?: number;
  gestures?: CanvasGestures;
  canvasRef?: RefObject<HTMLDivElement | null>;
  /** Своё перемещение вида (сдвиг, масштаб). */
  onMove: (update: CameraUpdate) => void;
  /** Указатель над холстом в координатах доски; `null` — ушёл с холста. */
  onPointer: (point: Point | null) => void;
  /** Размер области холста — для миникарты. */
  onResize?: (size: Size) => void;
  children?: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = canvasRef ?? ownRef;
  /** Зажатые указатели (пальцы, кнопка мыши): id → точка в области холста. */
  const pressed = useRef(new Map<number, Point>());
  const session = useRef<Session | null>(null);
  const lastPointerType = useRef("mouse");
  const latest = useRef({ onMove, wheelMode, onResize, camera, gestures });
  useEffect(() => {
    latest.current = { onMove, wheelMode, onResize, camera, gestures };
  });

  // React вешает wheel пассивным — без preventDefault колесо прокручивало бы страницу.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (element === null) return;
      const { point, size } = locate(element, event);
      const action = wheelAction(event, latest.current.wheelMode);
      latest.current.onMove((current) =>
        action.kind === "zoom"
          ? zoomAt(current, action.factor, point, size)
          : panBy(current, action.dx, action.dy),
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
    };
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const report = () => {
      latest.current.onResize?.({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };
    report(); // наблюдатель в фоновой вкладке молчит до первой отрисовки
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  // Таймер долгого нажатия не переживает холст.
  useEffect(
    () => () => {
      stopSession();
    },
    [],
  );

  function pressOf(
    element: HTMLElement,
    event: ReactPointerEvent | ReactMouseEvent,
    pointerType: string,
  ): CanvasPress {
    const { point, size } = locate(element, event);
    return {
      board: screenToBoard(point, latest.current.camera, size),
      screen: point,
      target: event.target,
      pointerType,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
  }

  function stopSession(): Session | null {
    const current = session.current;
    if (current?.timer) clearTimeout(current.timer);
    session.current = null;
    return current;
  }

  /** CVS-13: вид едет к краю, пока жест с автопрокруткой идёт и указатель у края. */
  function autoscroll(element: HTMLElement, gesture: Gesture) {
    // Таймер, а не requestAnimationFrame: кадры не приходят в перекрытом окне,
    // а тянуть объект к краю можно и там. Останавливается вместе с жестом.
    const timer = setInterval(() => {
      const current = session.current;
      if (current?.gesture !== gesture) {
        clearInterval(timer);
        return;
      }
      const size = { width: element.clientWidth, height: element.clientHeight };
      const v = edgeVelocity(current.last, size);
      if (!current.moved || (v.x === 0 && v.y === 0)) return;
      const view = panBy(latest.current.camera, -v.x, -v.y);
      latest.current.camera = view;
      latest.current.onMove(() => view);
      gesture.move({
        board: screenToBoard(current.last, view, size),
        ...current.modifiers,
      });
    }, AUTOSCROLL_TICK_MS);
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isIgnored(event.target)) return;
    lastPointerType.current = event.pointerType;
    // Левая или средняя кнопка мыши; касание и перо приходят как левая.
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault(); // без автопрокрутки браузера
    const element = event.currentTarget;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен — сдвиг продолжится без захвата.
    }
    const press = pressOf(element, event, event.pointerType);
    if (pressed.current.size > 0) {
      // Второй палец: начатый жест отменяется, дальше — щипок.
      stopSession()?.gesture?.cancel();
      pressed.current.set(event.pointerId, press.screen);
      return;
    }
    pressed.current.set(event.pointerId, press.screen);
    const gesture =
      event.button === 0 ? (gestures?.start(press, false) ?? null) : null;
    const current: Session = {
      pointerId: event.pointerId,
      press,
      gesture,
      moved: false,
      timer: null,
      last: press.screen,
      modifiers: { shiftKey: event.shiftKey, altKey: event.altKey },
    };
    session.current = current;
    if (gesture?.autoscroll) autoscroll(element, gesture);
    if (gesture === null && event.pointerType === "touch") {
      current.timer = setTimeout(() => {
        current.timer = null;
        if (session.current !== current || current.moved) return;
        if (pressed.current.size !== 1) return;
        const held = latest.current.gestures?.start(press, true) ?? null;
        current.gesture = held;
        if (held?.autoscroll) autoscroll(element, held);
      }, LONG_PRESS_MS);
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const { point, size } = locate(event.currentTarget, event);
    const fingers = pressed.current;
    const board = screenToBoard(point, camera, size);
    if (fingers.size <= 1) onPointer(board);

    const current = session.current;
    if (current?.pointerId === event.pointerId) {
      const tolerance =
        event.pointerType === "mouse"
          ? TAP_TOLERANCE.mouse
          : TAP_TOLERANCE.other;
      if (distance(point, current.press.screen) > tolerance) {
        current.moved = true;
        if (current.timer) clearTimeout(current.timer);
        current.timer = null;
      }
      current.last = point;
      current.modifiers = { shiftKey: event.shiftKey, altKey: event.altKey };
      if (current.gesture) {
        // Дрожание в пределах допуска — ещё щелчок, а не перетаскивание.
        if (current.moved)
          current.gesture.move({ board, ...current.modifiers });
        return;
      }
    }

    const previous = fingers.get(event.pointerId);
    if (previous === undefined) return;
    const before = firstPair(fingers);
    fingers.set(event.pointerId, point);
    const after = firstPair(fingers);
    if (before !== null && after !== null) {
      onMove((view) => pinch(view, before, after, size));
    } else {
      onMove((view) => panBy(view, point.x - previous.x, point.y - previous.y));
    }
  }

  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    // Оставшийся палец продолжает сдвиг со своего места, без скачка вида.
    pressed.current.delete(event.pointerId);
    if (session.current?.pointerId !== event.pointerId) return;
    const current = stopSession();
    if (current === null) return;
    if (event.type === "pointercancel") {
      current.gesture?.cancel();
      return;
    }
    const press = pressOf(event.currentTarget, event, event.pointerType);
    const { gesture } = current;
    if (gesture) {
      // BUG-004: отпускание на месте документ не меняет — объект не прилипает к сетке.
      if (current.moved) gesture.end(press);
      else if (gesture.click) gesture.click();
      else gesture.cancel();
    } else if (!current.moved) {
      gestures?.tap({ ...press, target: current.press.target });
    }
  }

  function contextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault(); // своё меню вместо меню браузера (CVS-23)
    if (isIgnored(event.target)) return;
    // Долгое касание на телефоне — это выделение (MOB-03), а не меню.
    if (lastPointerType.current === "touch") return;
    gestures?.contextMenu(pressOf(event.currentTarget, event, "mouse"));
  }

  const step = displayedStep(gridStep, camera.zoom);
  const offset = (axis: number) =>
    `calc(50% - ${String(axis * camera.zoom + step / 2)}px)`;
  return (
    <div
      ref={ref}
      className="board-canvas"
      data-testid="board-canvas"
      data-grid-step={gridStep}
      style={{
        backgroundColor: background,
        backgroundImage:
          step > 0
            ? `radial-gradient(circle, ${dotColor} 1px, transparent 1.5px)`
            : "none",
        backgroundSize: `${String(step)}px ${String(step)}px`,
        backgroundPosition: `${offset(camera.x)} ${offset(camera.y)}`,
      }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") onPointer(null);
      }}
      onContextMenu={contextMenu}
      onDoubleClick={(event) => {
        if (isIgnored(event.target)) return;
        // После захвата указателя dblclick приходит на сам холст — объект ищется по точке.
        const press = pressOf(
          event.currentTarget,
          event,
          lastPointerType.current,
        );
        gestures?.doubleClick({
          ...press,
          target: elementAt(event.clientX, event.clientY) ?? event.target,
        });
      }}
    >
      <div
        className="board-world"
        style={
          {
            transform: `scale(${String(camera.zoom)}) translate(${String(-camera.x)}px, ${String(-camera.y)}px)`,
            "--inverse-zoom": String(1 / camera.zoom),
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Экранный шаг точек сетки: при мелком масштабе точки прореживаются вдвое, вчетверо… */
function displayedStep(gridStep: number, zoom: number): number {
  if (gridStep <= 0) return 0;
  let step = gridStep * zoom;
  while (step < MIN_DOT_SPACING) step *= 2;
  return step;
}

function elementAt(x: number, y: number): Element | null {
  // jsdom не реализует elementFromPoint.
  return typeof document.elementFromPoint === "function"
    ? document.elementFromPoint(x, y)
    : null;
}

/** Поля ввода и панели поверх холста свои нажатия обрабатывают сами. */
function isIgnored(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("[data-canvas-ignore]") !== null
  );
}

/** Два первых зажатых указателя — пальцы щипка; `null`, если зажат один. */
function firstPair(pressed: Map<number, Point>): [Point, Point] | null {
  const [a, b] = pressed.values();
  return a !== undefined && b !== undefined ? [a, b] : null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Точка события относительно области холста и размер области. */
function locate(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
): { point: Point; size: Size } {
  const rect = element.getBoundingClientRect();
  return {
    point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
    size: { width: rect.width, height: rect.height },
  };
}
