import * as Y from "yjs";
import {
  decodeMessage,
  encodeSync,
  SyncKind,
  type SyncMessage,
} from "./messages";

/**
 * - `connecting` — первое подключение, документ ещё не получен;
 * - `online` — документ сверен с сервером, правки уходят сразу;
 * - `offline` — связь пропала, правки копятся в документе и уйдут после переподключения;
 * - `closed` — доступа к доске больше нет (или соединение остановлено).
 */
export type ConnectionStatus = "connecting" | "online" | "offline" | "closed";

export interface BoardConnectionOptions {
  doc: Y.Doc;
  url: string;
  onStatus?: (status: ConnectionStatus) => void;
  /** После разрыва: есть ли ещё доступ к доске. `false` останавливает переподключение. */
  checkAccess?: () => Promise<boolean>;
  createSocket?: (url: string) => WebSocket;
  /** Паузы перед повторными попытками, мс; последняя повторяется. */
  retryDelays?: readonly number[];
}

const DEFAULT_RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];
const SOCKET_OPEN = 1; // WebSocket.OPEN

/**
 * Провайдер документа доски поверх WebSocket `/api/ws` (COL-01, ARCHITECTURE.md, раздел 10).
 *
 * Правки других участников применяются к документу, свои отправляются сразу. Пока связи
 * нет, правки остаются в документе; после переподключения обмен векторами версий
 * досылает их серверу и забирает чужие.
 */
export class BoardConnection {
  private readonly options: BoardConnectionOptions;
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private status: ConnectionStatus = "connecting";
  private stopped = false;

  constructor(options: BoardConnectionOptions) {
    this.options = options;
    options.doc.on("update", this.sendLocalUpdate);
    this.connect();
  }

  /** Закрывает соединение и больше не переподключается. */
  destroy(): void {
    this.stop();
    this.socket?.close(1000);
    this.socket = null;
  }

  private connect(): void {
    const create =
      this.options.createSocket ?? ((url: string) => new WebSocket(url));
    const socket = create(this.options.url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      this.send(socket, SyncKind.Step1, Y.encodeStateVector(this.options.doc));
    };
    socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.receive(socket, new Uint8Array(event.data));
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      void this.afterDisconnect();
    };
    this.socket = socket;
  }

  private receive(socket: WebSocket, frame: Uint8Array): void {
    let message: SyncMessage | null;
    try {
      message = decodeMessage(frame);
    } catch {
      message = null;
    }
    if (message === null) return;
    const { doc } = this.options;
    if (message.kind === SyncKind.Step1) {
      // Сервер просит недостающее: сюда попадают и правки, сделанные без связи.
      this.send(
        socket,
        SyncKind.Step2,
        Y.encodeStateAsUpdate(doc, message.payload),
      );
      return;
    }
    Y.applyUpdate(doc, message.payload, this);
    if (message.kind === SyncKind.Step2) {
      this.attempt = 0;
      this.setStatus("online");
    }
  }

  private readonly sendLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // Чужие правки (origin — это соединение) обратно не отправляются. Без связи правка
    // остаётся в документе и уйдёт в ответ на вектор сервера после переподключения.
    if (origin === this || this.socket === null) return;
    this.send(this.socket, SyncKind.Update, update);
  };

  private send(socket: WebSocket, kind: SyncKind, payload: Uint8Array): void {
    if (socket.readyState === SOCKET_OPEN) {
      socket.send(encodeSync(kind, payload));
    }
  }

  private async afterDisconnect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus(this.status === "connecting" ? "connecting" : "offline");
    // Сбой самой проверки (нет сети) — не отказ: пробуем снова.
    const allowed = this.options.checkAccess
      ? await this.options.checkAccess().catch(() => true)
      : true;
    if (this.isStopped()) return; // страницу закрыли, пока шла проверка
    if (!allowed) {
      this.stop();
      this.setStatus("closed");
      return;
    }
    const delays = this.options.retryDelays ?? DEFAULT_RETRY_DELAYS;
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 0;
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private isStopped(): boolean {
    return this.stopped;
  }

  private stop(): void {
    this.stopped = true;
    this.options.doc.off("update", this.sendLocalUpdate);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }
}
