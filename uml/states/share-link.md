# Ссылка доски

Столбцы `boards.share_token` и `boards.share_token_revoked_at` (модуль `sharing`, `app.sharing.service`). У доски одна действующая ссылка `{PUBLIC_BASE_URL}/b/{share_token}`.

```mermaid
stateDiagram-v2
  [*] --> NotIssued: POST /api/boards → доска создана<br/>share_token = NULL
  NotIssued --> Active: GET /api/boards/{board_id}/share (SHR-01)<br/>current_token#58; UPDATE … SET share_token = new_token()<br/>WHERE share_token IS NULL
  NotIssued --> Active: POST /api/boards/{board_id}/share/reset<br/>reset_token#58; новый токен, share_token_revoked_at = now()
  Active --> Active: GET /api/boards/{board_id}/share<br/>тот же токен
  Active --> Active: POST /api/boards/{board_id}/share/reset (SHR-06)<br/>reset_token#58; share_token = new_token(),<br/>share_token_revoked_at = now(),<br/>delete_board_sessions(board_id)
  Active --> Unavailable: DELETE /api/boards/{board_id} (BRD-03)<br/>deleted_at = now(), board_by_token её не находит
  Unavailable --> [*]
```

Прежний токен после сброса в базе не хранится — он перезаписан. Поэтому для `board_by_token` отозванный, никогда не выданный и токен удалённой доски одинаковы:

```mermaid
stateDiagram-v2
  state check <<choice>>
  [*] --> check: GET /api/share/{token}<br/>POST /api/share/{token}/join
  check --> Rejected: пустой или длиннее 64 символов
  check --> Rejected: нет строки boards с share_token = token<br/>и deleted_at IS NULL (отозван, не выдавался, доска удалена)
  check --> Accepted: строка найдена
  Rejected --> [*]: 404 Link is not available (SHR-05)
  Accepted --> [*]: 200 SharedBoard
```

- Токен — `secrets.token_urlsafe(32)` (32 случайных байта, 43 символа), уникальный (`uq_boards_share_token`), не содержит id доски.
- Маршруты владельца (`/api/boards/{board_id}/share*`) требуют сессию пользователя досок (`401`) и отвечают `404 Board not found` на чужую, удалённую и несуществующую доску.
- `share_token_revoked_at` только фиксирует момент последнего сброса; в проверке токена не участвует.
- Сброс отзывает и гостевые сессии доски — см. [session.md](session.md), «Сессия участника по ссылке», — и сразу закрывает открытые каналы участников `/api/ws` кодом `4403` (`Hub.close_participants`, T4.1). Канал по `?token=` проходит ту же проверку `board_by_token`: отозванный токен — отказ рукопожатия `403`.

Актуально на: T4.1, 28e1b09. Требования: SHR-01, SHR-05, SHR-06.
