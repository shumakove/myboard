# Сессия

Строка таблицы `sessions` и cookie браузера. Реализованы сессии администратора (T1.1, cookie `myboard_admin`) и пользователя досок (T1.2, cookie `myboard_session`). Сессия участника по ссылке (T3.1) — строка `sessions` с `subject_type = guest` и cookie `myboard_board_{board_id.hex}` своей доски. Реакция открытой вкладки на отзыв сессии — T1.4.

## Сессия администратора

```mermaid
stateDiagram-v2
  [*] --> Active: POST /api/admin/login → 204<br/>create_session(ADMIN)#58; INSERT sessions, Set-Cookie myboard_admin
  Active --> Active: запрос с cookie<br/>find_subject(token, ADMIN) находит строку
  Active --> [*]: POST /api/admin/logout<br/>delete_session#58; DELETE строки, cookie стёрта
  Active --> Orphaned: браузер закрыт<br/>(cookie без Max-Age)
  Orphaned --> [*]
```

## Сессия пользователя досок

```mermaid
stateDiagram-v2
  [*] --> Active: POST /api/login → 204<br/>create_session(USER)#58; INSERT sessions,<br/>Set-Cookie myboard_session (Max-Age 400 дней)
  Active --> Active: GET /api/session<br/>find_subject(token, USER) + active_user → authenticated#58; true,<br/>cookie переустановлена с новым Max-Age (ACC-03)
  Active --> Active: браузер закрыт и открыт снова<br/>(cookie постоянная)
  Active --> [*]: POST /api/logout<br/>delete_session#58; DELETE строки, cookie стёрта
  Active --> [*]: PATCH /api/admin/users/{id} {password} → 200 (ADM-04)<br/>или {disabled#58; true} → 200 (ADM-05)<br/>update_user#58; delete_subject_sessions(USER, id) — все сессии пользователя
  Active --> Orphaned: cookie истекла без визитов 400 дней
  Orphaned --> [*]
```

- Значение cookie — `secrets.token_urlsafe(32)`; в базе `id = sha256(token)`. Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` только при `PUBLIC_BASE_URL` на `https://`.
- Проверка учитывает `subject_type`: сессия пользователя досок не открывает панель администратора, cookie администратора не является сессией пользователя.
- Сессия пользователя принимается, только если учётка существует и не отключена (`active_user`).
- Любое поле `password` в `PATCH /api/admin/users/{id}` (даже прежнее значение) отзывает все сессии пользователя (ADM-04); смена только имени или почты их не трогает — выданная ранее сессия продолжает действовать и в `GET /api/session` видит новые данные.
- Отзыв идёт в той же транзакции, что и правка учётки, и до изменения полей: при отказе `409` (почта занята) не меняются ни пароль, ни сессии. Сессии других пользователей и администратора не затрагиваются.
- Отозванная сессия: `GET /api/session` → `200 {authenticated: false}`, маршруты с `require_user` → `401`. Открытая вкладка узнаёт об этом сама — опросом (см. «Вкладка пользователя досок», ACC-05).
- Канал документа `/api/ws?board={id}` (T4.1) принимает только `Active` сессию пользователя досок — владельца живой доски (`realtime.access._owner`). Открытый канал перепроверяет доступ раз в 5 с: выход, смена пароля, отключение учётки, удаление доски закрывают его кодом `4403` не позже чем через 5 с; сброс ссылки канал владельца не трогает.
- `expires_at` сейчас всегда `NULL`, срок сессии в базе не проверяется. Строка сессии, cookie которой браузер выбросил (`Orphaned`), остаётся в базе — очистки нет.

Актуально на: T1.3, b53b509; канал WebSocket — T4.1, 28e1b09. Требования: ADM-01, ADM-04, ADM-05, ACC-01, ACC-03, COL-01.

## Сессия участника по ссылке

Модуль `sharing` (`service.join`, `service.participant`, `service.reset_token`) поверх `identity.sessions` (`create_session`, `find_board_session`, `delete_session`, `delete_board_sessions`).

```mermaid
stateDiagram-v2
  [*] --> Active: POST /api/share/{token}/join {name} → 200 (SHR-02, SHR-03)<br/>create_session(GUEST, uuid4, board_id, display_name)#58;<br/>INSERT sessions, Set-Cookie myboard_board_{board_id.hex} (без Max-Age)
  Active --> Active: GET /api/share/{token}<br/>find_board_session(cookie, board_id) → participant {name}
  Active --> Active: WS /api/ws?token={token} (T4.1)<br/>authorize → _participant#58; board_by_token, find_board_session,<br/>перепроверка раз в 5 с
  Active --> Replaced: POST /api/share/{token}/join {name} тем же браузером<br/>delete_session(cookie), затем новая сессия с новым именем
  Replaced --> [*]
  Active --> [*]: POST /api/boards/{board_id}/share/reset (SHR-06)<br/>delete_board_sessions(board_id)#58; DELETE всех guest-сессий доски,<br/>Hub.close_participants#58; открытые каналы → close(4403)
  Active --> Orphaned: браузер закрыт<br/>(cookie без Max-Age)
  Orphaned --> [*]
```

- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` только при `https://`; без `Max-Age` — до закрытия браузера. У каждой доски своя cookie: участник может быть на нескольких досках под разными именами, сброс ссылки одной доски не задевает другие.
- Сессия принимается только на своей доске (`board_id` в условии `find_board_session`) и только по действующему токену: маршрут сначала ищет доску по токену (`board_by_token`), отозванный токен — `404 Link is not available` при любой cookie.
- После сброса прежняя cookie на новой ссылке даёт `participant: null` — участник снова вводит имя. Сессии владельца и гостей других досок сброс не трогает.
- Гостевая сессия не является сессией пользователя досок (`find_subject(…, USER)` её не находит): `/api/boards*`, `/api/folders*` → `401`, `/` и `/boards/:id` уводят на `/login`. Учётная запись не создаётся.
- Строка `Orphaned` остаётся в базе до сброса ссылки доски — отдельной очистки нет. Открытая вкладка участника узнаёт о сбросе сразу: канал `/api/ws` закрывается кодом `4403`, страница перепроверяет ссылку и показывает Board unavailable (T4.1).

Актуально на: T4.1, 28e1b09. Требования: SHR-02, SHR-03, SHR-04, SHR-05, SHR-06.

## Вкладка пользователя досок

Состояние `AccountSessionState` хука `useAccountSession({ watch: true })` в `RequireAccount` — обёртке страниц `/`, `/boards/:id`, `/templates` (T1.4). Cookie скрипту не видна (`HttpOnly`), поэтому вкладка сверяет сессию через `GET /api/session`.

```mermaid
stateDiagram-v2
  [*] --> loading: RequireAccount смонтирован<br/>check()#58; GET /api/session
  loading --> signedIn: authenticated#58; true, name, email
  loading --> signedOut: authenticated#58; false<br/>или сбой сети без первого ответа
  signedIn --> signedIn: check() → authenticated#58; true<br/>(имя и почта обновлены, ADM-04)
  signedIn --> signedIn: check() — сбой сети<br/>(состояние не меняется)
  signedIn --> signedOut: check() → authenticated#58; false (ACC-05)
  signedIn --> signedOut: onUnauthorized#58; 401 любого запроса,<br/>кроме POST /api/login и /api/admin/* (ACC-05)
  signedOut --> [*]: Redirect /login (replace)<br/>RequireAccount размонтирован#58; опрос и подписки сняты
```

`check()` вызывается:

- при монтировании;
- каждые `SESSION_CHECK_INTERVAL_MS` = 2000 мс по `setInterval`, пока `document.visibilityState === "visible"`; у скрытой вкладки таймер снят;
- сразу при `visibilitychange` в видимое состояние и при `focus` окна.

- Одновременно идёт не более одной проверки (`checking`). `signedOut` окончательный: запоздавший ответ `authenticated: true` не возвращает вкладку в `signedIn`.
- Сигнал `401` даёт `api/client.ts`: middleware `onResponse` рассылает запрос подписчикам `onUnauthorized`; `401` входа (`/api/login`) и панели (`/api/admin/*`) вкладку пользователя не выбивают.
- `LoginPage` вызывает `useAccountSession()` без `watch`: одна проверка при открытии, без опроса. `/t/:token`, `/b/:token`, `/b/:token/embed`, страницы панели — без `RequireAccount`.

Актуально на: T1.4, 6f59eaf. Требования: ACC-03, ACC-05, ADM-04, ADM-05.
