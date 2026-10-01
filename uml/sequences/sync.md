# Синхронизация документа

Совместная правка доски (COL-01) по WebSocket `/api/ws`. Клиент — `BoardConnection` (`apps/web/src/realtime/boardConnection.ts`) внутри `useBoardConnection` / `BoardLive` на `/boards/:id` и `/b/:token`; сервер — `app.realtime.router.board_socket`, `Hub`, `BoardRoom`, `store`. Формат кадров — [ws-protocol.md](../ws-protocol.md).

## Подключение и правка

```mermaid
sequenceDiagram
  autonumber
  participant A as Клиент A (BoardConnection)
  participant B as Клиент B
  participant R as realtime.router
  participant X as realtime.access
  participant H as Hub
  participant M as BoardRoom (pycrdt.Doc)
  participant S as realtime.store
  participant L as library.service
  participant DB as PostgreSQL

  A->>R: WS /api/ws?board={id} или ?token={token}
  R->>R: _same_origin: Origin отсутствует или его host = Host
  R->>X: authorize(db, AccessRequest(board, token, cookies))
  Note over X: board → _owner: USER-сессия, active_user, get_board<br/>token → _participant: board_by_token, find_board_session
  alt нет доступа
    R-->>A: close(1008) до accept → 403
  else BoardAccess(board_id, guest)
    R->>R: accept, Peer(websocket, guest)
    R->>H: join(board_id, peer)
    opt доска не открыта в процессе
      H->>S: load_updates(db, board_id), last_seq(db, board_id)
      S->>DB: SELECT update FROM board_updates ORDER BY seq
      H->>M: BoardRoom(board_id, updates, last_seq): apply_update каждого
    end
    R->>R: create_task(_watch_access): authorize раз в 5 с
    R-->>A: sync STEP1(room.state_vector())
    A->>R: sync STEP1(Y.encodeStateVector(doc))
    R->>M: missing_since(вектор A)
    R-->>A: sync STEP2(недостающее, на пустой вектор — полный снимок)
    A->>A: Y.applyUpdate(STEP2, origin = connection), status online
    A->>R: sync STEP2(Y.encodeStateAsUpdate(doc, вектор сервера))
    Note over R,M: пустое обновление 00 00 игнорируется,<br/>иначе — как UPDATE ниже
  end

  A->>A: локальная правка doc → on("update")
  A->>R: sync UPDATE(update)
  R->>M: apply(update, sender = A, hub.persist)
  activate M
  Note over M: asyncio.Lock: один порядок для всех соединений доски
  M->>M: _doc.apply_update(update)
  alt ValueError
    M-->>R: ProtocolError
    R-->>A: close(1007), документ и B не изменились
  else принято
    M->>M: _seq += 1
    M->>H: persist(board_id, seq, update)
    H->>S: append_update(db, board_id, seq, update)
    S->>DB: INSERT board_updates (board_id, seq, update)
    S->>L: touch_board(db, board_id)
    L->>DB: UPDATE boards SET updated_at = now()
    S->>DB: COMMIT
    M-->>B: sync UPDATE(update) — всем peers, кроме отправителя
  end
  deactivate M
  B->>B: Y.applyUpdate(update, origin = connection) — обратно не отправляется
```

## Разрыв и переподключение

```mermaid
sequenceDiagram
  autonumber
  participant U as BoardLive / useBoardConnection
  participant C as BoardConnection
  participant P as Страница (checkAccess)
  participant R as /api/ws

  R--xC: onclose (сеть, рестарт api, 1007, 4403)
  C->>U: onStatus(offline) — «Offline. Your changes will be sent…»<br/>(до первого STEP2 — остаётся connecting)
  Note over C: правки без связи копятся в Y.Doc, не отправляются
  C->>P: checkAccess()
  Note over P: владелец: getBoard(id) — 401/404 → false<br/>участник: openSharedBoard(token) — 404 или participant null → false<br/>сбой самой проверки → true
  alt false
    C->>C: stop(): без переподключения
    C->>U: onStatus(closed)
    U->>P: onClosed → SharedBoardPage.recheck → Board unavailable или форма имени
  else true
    C->>C: setTimeout(500, 1000, 2000, 4000, 8000, 8000… мс)
    C->>R: новый WebSocket, затем обмен STEP1/STEP2 как выше
    Note over C,R: в ответ на STEP1 сервера уходят правки, сделанные без связи
    C->>U: onStatus(online), счётчик попыток сброшен
  end
```

- Документ сервера выгружается из памяти, когда уходит последнее соединение доски; следующий клиент получает состояние, собранное из `board_updates` (переживает и перезапуск `api`).
- Снимков (`board_snapshots`) и сжатия журнала пока нет (T4.3): серверная копия каждый раз собирается из всего журнала.
- Ошибка отправки одному соединению (`Peer.send`) не прерывает рассылку остальным; разрыв замечает цикл приёма этого соединения.

Актуально на: T4.1, 28e1b09. Требования: COL-01, SHR-04 (канал), BRD-04 (`updated_at` при правке).
