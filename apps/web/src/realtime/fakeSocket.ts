// Тестовый двойник WebSocket и сервера документа доски (тот же протокол, что у API).
import * as Y from "yjs";
import { decodeMessage, encodeSync, SyncKind } from "./messages";

/** WebSocket без сети: тест сам открывает, закрывает и передаёт кадры. */
export class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  binaryType: BinaryType = "blob";
  sent: Uint8Array[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  /** Куда уходят отправленные кадры (подключённый двойник сервера). */
  onSend: ((frame: Uint8Array) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
    this.onSend?.(data);
  }

  close(code = 1000): void {
    this.drop(code);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(frame: Uint8Array): void {
    const data = frame.slice().buffer;
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  drop(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onSend = null;
    this.onclose?.(new CloseEvent("close", { code }));
  }

  static last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error("WebSocket не создан");
    return socket;
  }
}

/** Сервер документа: применяет правку к своей копии и рассылает остальным. */
export class FakeBoardServer {
  readonly doc = new Y.Doc();
  private readonly peers = new Set<FakeSocket>();

  accept(socket: FakeSocket): void {
    this.peers.add(socket);
    socket.onSend = (frame) => {
      this.handle(socket, frame);
    };
    socket.open();
    socket.receive(encodeSync(SyncKind.Step1, Y.encodeStateVector(this.doc)));
  }

  disconnect(socket: FakeSocket, code?: number): void {
    this.peers.delete(socket);
    socket.drop(code);
  }

  private handle(socket: FakeSocket, frame: Uint8Array): void {
    const message = decodeMessage(frame);
    if (message === null) throw new Error("незнакомый кадр");
    if (message.kind === SyncKind.Step1) {
      const missing = Y.encodeStateAsUpdate(this.doc, message.payload);
      socket.receive(encodeSync(SyncKind.Step2, missing));
      return;
    }
    Y.applyUpdate(this.doc, message.payload);
    for (const peer of this.peers) {
      if (peer !== socket) {
        peer.receive(encodeSync(SyncKind.Update, message.payload));
      }
    }
  }
}
