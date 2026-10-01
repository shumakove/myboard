import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { FakeSocket } from "./realtime/fakeSocket";

afterEach(cleanup);

// jsdom не прокручивает: боковой список вызывает scrollIntoView у найденной папки.
Element.prototype.scrollIntoView = () => undefined;

// Страницы доски открывают канал /api/ws: в тестах — двойник без сети.
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
afterEach(() => {
  FakeSocket.instances = [];
});
