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

  WA->>WA: move(): мышь, палец (panBy), щипок (pinch),<br/>колесо (zoomAt / panBy), кнопки и клавиши (zoomBy, panBy),<br/>миникарта (centerOn)
  WA->>PA: setLocal({camera})
  PA->>R: awareness {camera: {x, y, zoom}}
  R-->>PB: awareness A
  PB-->>WB: subscribe: camera ← state.camera A (если вид другой)

  alt Stop following
    U->>WB: following = null
  else свой сдвиг или масштаб (BoardCanvas.onMove, CameraControls,<br/>useCameraKeys, Minimap.onNavigate)
    U->>WB: move(): following = null, camera = свой вид
  else A ушёл
    PB-->>WB: A нет в peers → following = null
  end
  WB->>PB: setLocal({camera, following: null})
  Note over WB: вид остаётся там, где был
```

## Лазерная указка (DRW-05)

```mermaid
sequenceDiagram
  autonumber
  actor U as Участник A
  participant SA as BoardScene A: useSceneGestures / useLaser
  participant PA as BoardPresence A
  participant R as BoardRoom
  participant PB as BoardPresence B
  participant WB as BoardWorkspace B: RemoteLasers

  U->>SA: инструмент Laser (R), нажатие на холсте
  SA->>SA: laserGesture: begin(press.board) — новая линия следа
  SA-->>U: LaserView Your laser (красный)
  SA->>PA: onLaser(encodeTrail(trail)) → setLocal({laser: [[x0, y0, …]]})
  PA->>R: awareness {cursor, camera, following, laser}
  R->>R: update_awareness: Peer.awareness = state<br/>(в документ и board_updates не пишется)
  R-->>PB: awareness {peer: A, name, state}
  PB-->>WB: RemoteLasers: LaserView «имя A's laser» цветом peerColor(A)
  loop движение указателя
    U->>SA: move → add(board): точка не ближе 4 единиц доски к прошлой,<br/>не больше LASER_MAX_POINTS = 100 точек
    SA->>PA: setLocal({laser})
    PA->>R: awareness (не чаще раза в AWARENESS_INTERVAL_MS = 50)
    R-->>PB: awareness A
  end
  loop каждые LASER_TICK_MS = 100, пока след есть
    SA->>SA: fade: точки старше LASER_FADE_MS = 3000 убираются
    SA->>PA: setLocal({laser: остаток})
  end
  SA->>PA: след пуст → setLocal({laser: null})
  PA->>R: awareness {…, laser: null}
  R-->>PB: awareness A
  PB-->>WB: следа A нет
```

- Скрытие курсоров (COL-03) — кнопка `Hide cursors` / `Show cursors` в `PresencePanel`: локальный флаг `cursorsShown` вкладки, `RemoteCursors` не рисуется; в канал ничего не уходит.
- Свой курсор не рисуется (`self`); две вкладки одного человека — два соединения и две строки списка.
- Камера (T5.1, `canvas/camera.ts`, масштаб `MIN_ZOOM = 0.1`…`MAX_ZOOM = 8`): любое своё движение вида — мышь, колесо, клавиши, кнопки, касание, щипок, миникарта — идёт через `BoardWorkspace.move` и выключает слежение. Вид ведущего, полученный по `awareness`, повторяется и у наблюдателя запоминается в `localStorage` как его собственный (CVS-05). Курсор касанием передаётся, пока движется один палец; во время щипка (два зажатых указателя) курсор не шлётся, при отрыве не убирается (`null` — только для мыши).
- След лазера (T6.5, DRW-05) рисуется всегда, независимо от `Hide cursors`; новичок получает его в последнем состоянии `announce`, пока след не погас. Как и остальное присутствие, в снимки и резервные копии он не входит.
- Присутствие не попадает в документ и `board_updates`; при сбросе ссылки (`Hub.close_participants`) и отзыве доступа (`_watch_access`) соединение закрывается `4403` и сразу пропадает из `presence` у остальных.

Актуально на: T6.5, d31412e (лазерная указка; остальное — T5.1, 34125f1). Требования: COL-02, COL-03, COL-04 (в том числе на жестах телефона, MOB-02), COL-09, DRW-05.
