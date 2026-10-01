# Сброс ссылки

Владелец сбрасывает ссылку в диалоге Share (SHR-06). Подтверждение — внутри диалога, без `window.confirm`. Маршрут — `app.sharing.router.reset_share_link`, логика — `app.sharing.service.reset_token`, закрытие открытых каналов участников — `app.realtime.hub.Hub.close_participants` (T4.1).

```mermaid
sequenceDiagram
  autonumber
  actor O as Владелец
  participant D as ShareDialog
  participant A as sharingApi
  participant R as sharing.router
  participant L as library.service
  participant S as sharing.service
  participant SS as identity.sessions
  participant DB as PostgreSQL
  participant H as realtime.Hub
  actor G as Участник по старой ссылке

  O->>D: Reset link
  D-->>O: Reset the link? … (кнопки Reset / Cancel)
  alt Cancel
    D-->>O: ссылка прежняя, запросов нет
  else Reset
    D->>A: resetShareLink(boardId)
    A->>R: POST /api/boards/{board_id}/share/reset
    Note over R: UserDep: без сессии пользователя → 401
    R->>L: get_board(db, user.id, board_id)
    alt чужая, удалённая или несуществующая доска
      R-->>A: 404 "Board not found"
      D-->>O: Board not found.
    else своя доска
      R->>S: reset_token(db, board)
      S->>S: new_token() = token_urlsafe(32)
      S->>DB: UPDATE boards SET share_token = новый,<br/>share_token_revoked_at = now()
      S->>SS: delete_board_sessions(db, board.id)
      SS->>DB: DELETE sessions WHERE subject_type = guest AND board_id = …
      S->>DB: COMMIT (одна транзакция)
      R->>H: close_participants(board.id)
      H-->>G: WS close(4403) каждому Peer с guest = true (канал владельца остаётся)
      R-->>A: 200 ShareLink {token, url} — новый адрес
      D-->>O: Board link = новый url,<br/>New link created. The previous link no longer works.
    end
  end

  Note over G: BoardConnection: onclose → checkAccess() = openSharedBoard(старый token)
  G->>R: GET /api/share/{старый token} (со старой cookie)
  R->>S: board_by_token(db, старый token)
  S->>DB: SELECT boards WHERE share_token = старый → нет строки
  R-->>G: 404 "Link is not available" (SHR-05)
  Note over G: checkAccess → false, status closed → recheck:<br/>Board unavailable / This link is not available. без перезагрузки
  Note over G,R: WS /api/ws?token={старый token} → 403 (board_by_token → None),<br/>WS /api/ws?token={новый token} со старой cookie → 403 (find_board_session → None)
  G->>R: GET /api/share/{новый token} (со старой cookie)
  R->>S: participant(db, board, старая cookie)
  S->>SS: find_board_session → None (строка удалена)
  R-->>G: 200 SharedBoard {participant: null} — нужно снова ввести имя
```

- Сессия владельца (`subject_type = user`) и гостевые сессии других досок не затрагиваются.
- Открытая вкладка участника узнаёт о сбросе сразу: сервер закрывает её канал кодом `4403`, клиент перепроверяет ссылку и показывает отказ без перезагрузки (T4.1, [ws-protocol.md](../ws-protocol.md)).

Актуально на: T4.1, 28e1b09. Требования: SHR-05, SHR-06.
