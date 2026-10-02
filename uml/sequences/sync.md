# Синхронизация документа

Совместная правка доски (COL-01) по WebSocket `/api/ws`. Клиент — `BoardConnection` (`apps/web/src/realtime/boardConnection.ts`) внутри `useBoardConnection` / `BoardLive` на `/boards/:id` и `/b/:token`; сервер — `app.realtime.router.board_socket`, `Hub`, `BoardRoom`, `store`, `app.history` (снимки и лента, T4.3). Формат кадров — [ws-protocol.md](../ws-protocol.md).

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
  participant HI as history (snapshots, events)
  participant DB as PostgreSQL

  A->>R: WS /api/ws?board={id} или ?token={token}
  R->>R: _same_origin: Origin отсутствует или его host = Host
  R->>X: authorize(db, AccessRequest(board, token, cookies))
  Note over X: board → _owner: USER-сессия, active_user, get_board<br/>token → _participant: board_by_token, find_board_session
  alt нет доступа
    R-->>A: close(1008) до accept → 403
  else BoardAccess(board_id, guest, name)
    R->>R: accept, Peer(websocket, name, guest)
    R->>H: join(board_id, peer)
    opt доска не открыта в процессе
      H->>S: load_journal(db, board_id)
      Note over S,DB: одна транзакция REPEATABLE READ
      S->>HI: snapshots.latest_state(db, board_id)
      HI->>DB: SELECT state FROM board_snapshots<br/>ORDER BY created_at DESC, id DESC LIMIT 1
      S->>DB: SELECT seq, update FROM board_updates ORDER BY seq
      H->>M: BoardRoom(board_id, Journal(snapshot, updates, last_seq)):<br/>apply_update снимка и каждого обновления,<br/>_compacted_seq = 0, затем observe(trash)
    end
    R->>R: create_task(_watch_access): authorize раз в 5 с
    R-->>A: sync STEP1(room.state_vector())
    R->>M: announce(peer): awareness остальных и presence всем (T4.2)
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
  M->>M: _trashed = [], _doc.apply_update(update)
  Note over M: _on_trash_change: ключи trash с action add/update → _trashed
  alt ValueError
    M-->>R: ProtocolError
    R-->>A: close(1007), документ и B не изменились
  else принято
    M->>M: _seq += 1
    M->>H: persist(JournalEntry(board_id, seq, update, sender.name, trashed))
    H->>S: append(db, entry)
    S->>DB: INSERT board_updates (board_id, seq, update)
    opt entry.trashed не пуст (удаление объектов, основа COL-08)
      S->>HI: events.add_objects_deleted(db, board_id, actor_name, trashed)
      HI->>DB: INSERT board_events (objects_deleted, {object_ids})
    end
    S->>L: touch_board(db, board_id)
    L->>DB: UPDATE boards SET updated_at = now()
    S->>DB: COMMIT
    M-->>B: sync UPDATE(update) — всем peers, кроме отправителя
  end
  deactivate M
  B->>B: Y.applyUpdate(update, origin = connection) — обратно не отправляется
```

## Сжатие журнала (снимок)

```mermaid
sequenceDiagram
  autonumber
  participant APP as app.main lifespan
  participant R as realtime.router
  participant H as Hub
  participant M as BoardRoom
  participant S as realtime.store
  participant HI as history.snapshots
  participant DB as PostgreSQL

  APP->>H: create_task(run_compaction(SNAPSHOT_INTERVAL_SECONDS))
  loop каждые SNAPSHOT_INTERVAL_SECONDS (по умолчанию 300 с)
    H->>H: compact_all(): _compact(room) для каждой открытой доски
  end
  R->>H: leave(room, peer) в CancelScope(shield=True)
  opt ушло последнее соединение
    H->>H: под блокировкой Hub: удалить room из _rooms, _compact(room)
  end
  APP->>H: при остановке: cancel(run_compaction), compact_all()

  Note over H,DB: _compact(room)
  H->>M: compact(_write_snapshot)
  Note over M: _compaction_lock, затем _lock
  alt _seq == _compacted_seq (правок не было)
    M-->>H: False, снимок не пишется
  else были правки
    M->>M: seq, state = _seq, _doc.get_update()
    M->>H: _write_snapshot(board_id, state, seq)
    H->>S: compact(db, board_id, state, upto_seq = seq)
    S->>HI: add_snapshot(db, board_id, state)
    HI->>DB: INSERT board_snapshots (board_id, state)
    S->>DB: DELETE board_updates WHERE seq <= upto_seq
    S->>DB: COMMIT
    M->>M: _compacted_seq = seq
    M-->>H: True
  end
  Note over H: SQLAlchemyError → logger.exception, журнал цел, повтор в следующий раз
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

- Документ сервера выгружается из памяти, когда уходит последнее соединение доски (и журнал сжимается); следующий клиент получает состояние, собранное из последнего снимка и хвоста `board_updates`, — в `STEP2` на пустой вектор это полное состояние (переживает и перезапуск `api`: при остановке процесса открытые доски сжимаются).
- Блокировка `Hub` держится на время загрузки (`join`) и выгрузки со сжатием (`leave`): новое подключение к доске читает уже сжатый журнал.
- Снимки не удаляются; их просмотр и восстановление — T8.2.
- Вместе с `sync` по тому же каналу идут `awareness` и `presence` (T4.2): они не применяются к документу и не пишутся в журнал — сценарий [presence.md](presence.md).
- Ошибка отправки одному соединению (`Peer.send`) не прерывает рассылку остальным; разрыв замечает цикл приёма этого соединения.

Актуально на: T4.3, 7477309. Требования: COL-01, SHR-04 (канал), BRD-04 (`updated_at` при правке), COL-07 и COL-08 (основа: снимки, лента удалений).
