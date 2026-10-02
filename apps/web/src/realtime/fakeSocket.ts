// Тестовый двойник WebSocket и сервера доски (тот же протокол, что у API).
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import {
  encodeSync,
  MessageType,
  SyncKind,
  type AwarenessState,
} from "./messages";

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

/** Кадр клиента, как его разбирает сервер. */
export type ClientFrame =
  | { type: "sync"; kind: number; payload: Uint8Array }
  | { type: "awareness"; state: AwarenessState };

export function decodeClientFrame(frame: Uint8Array): ClientFrame {
  const decoder = decoding.createDecoder(frame);
  const type = decoding.readVarUint(decoder);
  if (type === MessageType.Sync) {
    const kind = decoding.readVarUint(decoder);
    return { type: "sync", kind, payload: decoding.readVarUint8Array(decoder) };
  }
  if (type === MessageType.Awareness) {
    const state = JSON.parse(decoding.readVarString(decoder)) as AwarenessState;
    return { type: "awareness", state };
  }
  throw new Error("незнакомый кадр");
}

/** Кадр присутствия сервера (`awareness` или `presence`) с JSON-содержимым. */
export function encodeServerJson(type: number, value: unknown): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  encoding.writeVarString(encoder, JSON.stringify(value));
  return encoding.toUint8Array(encoder);
}

interface Peer {
  id: string;
  name: string;
  state: AwarenessState | null;
}

/**
 * Сервер доски: применяет правку к своей копии и рассылает остальным; ведёт список
 * присутствующих и пересылает их состояния (имя — от сервера, как у API).
 */
export class FakeBoardServer {
  readonly doc = new Y.Doc();
  private readonly peers = new Map<FakeSocket, Peer>();
  private connections = 0;

  accept(socket: FakeSocket, name = "Alice"): void {
    this.connections += 1;
    const id = `peer-${String(this.connections)}`;
    const peer: Peer = { id, name, state: null };
    this.peers.set(socket, peer);
    socket.onSend = (frame) => {
      this.handle(socket, frame);
    };
    socket.open();
    socket.receive(encodeSync(SyncKind.Step1, Y.encodeStateVector(this.doc)));
    for (const other of this.peers.values()) {
      if (other !== peer && other.state !== null) {
        socket.receive(awarenessFrame(other));
      }
    }
    this.sendPresence();
  }

  disconnect(socket: FakeSocket, code?: number): void {
    this.peers.delete(socket);
    socket.drop(code);
    this.sendPresence();
  }

  private handle(socket: FakeSocket, frame: Uint8Array): void {
    const message = decodeClientFrame(frame);
    if (message.type === "awareness") {
      const sender = this.peers.get(socket);
      if (sender === undefined) return;
      sender.state = message.state;
      this.broadcast(socket, awarenessFrame(sender));
      return;
    }
    if (message.kind === SyncKind.Step1) {
      const missing = Y.encodeStateAsUpdate(this.doc, message.payload);
      socket.receive(encodeSync(SyncKind.Step2, missing));
      return;
    }
    Y.applyUpdate(this.doc, message.payload);
    this.broadcast(socket, encodeSync(SyncKind.Update, message.payload));
  }

  private broadcast(sender: FakeSocket, frame: Uint8Array): void {
    for (const socket of this.peers.keys()) {
      if (socket !== sender) socket.receive(frame);
    }
  }

  private sendPresence(): void {
    const roster = [...this.peers.values()].map(({ id, name }) => ({
      peer: id,
      name,
    }));
    for (const [socket, peer] of this.peers) {
      socket.receive(
        encodeServerJson(MessageType.Presence, {
          self: peer.id,
          peers: roster,
        }),
      );
    }
  }
}

function awarenessFrame(peer: Peer): Uint8Array {
  return encodeServerJson(MessageType.Awareness, {
    peer: peer.id,
    name: peer.name,
    state: peer.state,
  });
}
