# Присутствие и курсоры

Кто сейчас на доске (COL-09), чужие курсоры с именами (COL-02) и их скрытие (COL-03), «смотреть глазами участника» (COL-04). Клиент — `BoardLive` → `BoardWorkspace` (`apps/web/src/collab`), холст `BoardCanvas` (`apps/web/src/canvas`), состояние — `BoardPresence` (`apps/web/src/realtime/boardPresence.ts`) поверх канала `BoardConnection`; сервер — `BoardRoom.announce`, `update_awareness`, `announce_leave` (`app.realtime.room`). Кадры — [ws-protocol.md](../ws-protocol.md).

## Вход, курсор, выход

```mermaid
sequenceDiagram
  autonumber
  participant WA as Вкладка A: BoardWorkspace / BoardCanvas
  participant PA as BoardPresence A
  participant CA as BoardConnection A
  participant R as realtime.router + BoardRoom
  participant CB as BoardConnection B
  participant PB as BoardPresence B
  participant WB as Вкладка B: PresencePanel / RemoteCursors

  Note over R,CB: B уже на доске
  CA->>R: WS /api/ws (authorize → BoardAccess.name)
  R->>R: Peer(name, guest), id = token_hex(8)
  R-->>CA: sync STEP1
  R-->>CA: awareness {peer: B, name, state} — последнее состояние B
  R-->>CA: presence {self: A, peers: [A, B]}
  R-->>CB: presence {self: B, peers: [A, B]}
  CA->>PA: receive(awareness / presence)
  CB->>PB: receive(presence) — состояния ушедших из списка удаляются
  PB-->>WB: getSnapshot(): peers [{peer, name, self, state}] (useSyncExternalStore)
  WB-->>WB: On this board (2), строка «<имя> (you)»
  CA->>PA: onopen → attach(send)
  PA->>R: awareness {cursor: null, camera, following: null}

  WA->>WA: pointermove над холстом → screenToBoard(point, camera, size)
  WA->>PA: setLocal({cursor})
  Note over PA: сразу, затем не чаще раза в AWARENESS_INTERVAL_MS = 50
  PA->>R: awareness {cursor: {x, y}, camera, following}
  R->>R: update_awareness: Peer.awareness = state
  R-->>CB: awareness {peer: A, name из сессии, state}
  CB->>PB: receive → states[A] = state
  PB-->>WB: RemoteCursors: стрелка цвета peerColor(A) и подпись с именем<br/>в координатах доски (left/top внутри board-world, scale 1/zoom)
  WA->>PA: pointerleave мыши → setLocal({cursor: null})
  PA->>R: awareness {cursor: null, …}
  R-->>CB: awareness — курсор A убран

  CA--xR: вкладка закрыта / разрыв
  CA->>PA: detach(): список и состояния очищены
  R->>R: hub.leave, announce_leave
  R-->>CB: presence {self: B, peers: [B]}
  CB->>PB: receive → states[A] удалено
  PB-->>WB: On this board (1), курсора A нет
```

## Слежение за участником (COL-04)

```mermaid
sequenceDiagram
  autonumber
  actor U as Наблюдатель B
  participant WB as BoardWorkspace B
  participant PB as BoardPresence B
  participant R as BoardRoom
  participant PA as BoardPresence A
  participant WA as BoardWorkspace A

  U->>WB: Follow <имя A> (PresencePanel)
  WB->>WB: camera = state.camera A, following = A
  WB->>PB: setLocal({camera, following: A})
  PB->>R: awareness {…, following: A}
  R-->>PA: awareness B → у A в списке «B · following <имя A>»
  WB-->>U: плашка Following <имя A> + Stop following, рамка цвета A,<br/>кнопка Following (disabled)

  WA->>WA: перетаскивание (panBy) / колесо (zoomAt)
  WA->>PA: setLocal({camera})
  PA->>R: awareness {camera: {x, y, zoom}}
  R-->>PB: awareness A
  PB-->>WB: subscribe: camera ← state.camera A (если вид другой)

  alt Stop following
    U->>WB: following = null
  else свой сдвиг или масштаб (BoardCanvas.onMove)
    U->>WB: move(): following = null, camera = свой вид
  else A ушёл
    PB-->>WB: A нет в peers → following = null
  end
  WB->>PB: setLocal({camera, following: null})
  Note over WB: вид остаётся там, где был
```

- Скрытие курсоров (COL-03) — кнопка `Hide cursors` / `Show cursors` в `PresencePanel`: локальный флаг `cursorsShown` вкладки, `RemoteCursors` не рисуется; в канал ничего не уходит.
- Свой курсор не рисуется (`self`); две вкладки одного человека — два соединения и две строки списка.
- Камера минимальная (`canvas/camera.ts`: `HOME`, `screenToBoard`, `boardToScreen`, `panBy`, `zoomAt`, масштаб `MIN_ZOOM = 0.1`…`MAX_ZOOM = 8`); курсор касанием передаётся, пока палец движется, и при отрыве не убирается (`null` — только для мыши).
- Присутствие не попадает в документ и `board_updates`; при сбросе ссылки (`Hub.close_participants`) и отзыве доступа (`_watch_access`) соединение закрывается `4403` и сразу пропадает из `presence` у остальных.

Актуально на: T4.2, 1e65608. Требования: COL-02, COL-03, COL-04, COL-09.
