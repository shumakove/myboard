import type { AwarenessState, PresencePeer, ServerMessage } from "./messages";

/** Участник на доске (одно соединение) и его последнее состояние присутствия. */
export interface PeerPresence extends PresencePeer {
  /** Это соединение — текущая вкладка. */
  self: boolean;
  state: Partial<AwarenessState>;
}

export interface PresenceSnapshot {
  peers: readonly PeerPresence[];
}

/** Как часто уходит своё состояние: курсор движется плавно, канал не забивается. */
export const AWARENESS_INTERVAL_MS = 50;

const NOBODY: PresenceSnapshot = { peers: [] };

/**
 * Присутствие на доске (COL-02…COL-04, COL-09): кто сейчас здесь, их курсоры и виды
 * камеры, и своё состояние для остальных. Живёт только в памяти вкладки и в канале,
 * в документ доски не попадает. Подписка — по контракту `useSyncExternalStore`.
 */
export class BoardPresence {
  private local: AwarenessState = {
    cursor: null,
    camera: null,
    following: null,
  };
  private roster: PresencePeer[] = [];
  private selfId: string | null = null;
  private readonly states = new Map<string, Partial<AwarenessState>>();
  private snapshot = NOBODY;
  private readonly listeners = new Set<() => void>();
  private send: ((state: AwarenessState) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PresenceSnapshot => this.snapshot;

  /** Меняет своё состояние; уходит сразу, затем не чаще раза в AWARENESS_INTERVAL_MS. */
  setLocal(patch: Partial<AwarenessState>): void {
    this.local = { ...this.local, ...patch };
    if (this.timer !== null) {
      this.pending = true;
      return;
    }
    this.flush();
  }

  /** Канал открыт: своё состояние уходит в него сразу и после каждого изменения. */
  attach(send: (state: AwarenessState) => void): void {
    this.send = send;
    this.flush();
  }

  /** Канал закрыт: кто на доске — неизвестно до следующего подключения. */
  detach(): void {
    this.send = null;
    this.roster = [];
    this.selfId = null;
    this.states.clear();
    this.publish();
  }

  receive(message: ServerMessage): void {
    if (message.type === "presence") {
      this.roster = message.peers;
      this.selfId = message.self;
      const present = new Set(message.peers.map((p) => p.peer));
      for (const peer of this.states.keys()) {
        if (!present.has(peer)) this.states.delete(peer);
      }
    } else if (message.type === "awareness") {
      this.states.set(message.peer, message.state);
    } else {
      return;
    }
    this.publish();
  }

  private flush(): void {
    this.pending = false;
    if (this.send === null) return;
    this.send(this.local);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) this.flush();
    }, AWARENESS_INTERVAL_MS);
  }

  private publish(): void {
    this.snapshot = {
      peers: this.roster.map((peer) => ({
        ...peer,
        self: peer.peer === this.selfId,
        state: this.states.get(peer.peer) ?? {},
      })),
    };
    for (const listener of this.listeners) listener();
  }
}
