# Сессия

Строка таблицы `sessions` и cookie браузера. Реализованы сессии администратора (T1.1, cookie `myboard_admin`) и пользователя досок (T1.2, cookie `myboard_session`). Сессии участника по ссылке — T3.1.

## Сессия администратора

```mermaid
stateDiagram-v2
  [*] --> Active: POST /api/admin/login → 204<br/>create_session(ADMIN): INSERT sessions, Set-Cookie myboard_admin
  Active --> Active: запрос с cookie<br/>find_subject(token, ADMIN) находит строку
  Active --> [*]: POST /api/admin/logout<br/>delete_session: DELETE строки, cookie стёрта
  Active --> Orphaned: браузер закрыт<br/>(cookie без Max-Age)
  Orphaned --> [*]
```

## Сессия пользователя досок

```mermaid
stateDiagram-v2
  [*] --> Active: POST /api/login → 204<br/>create_session(USER): INSERT sessions,<br/>Set-Cookie myboard_session (Max-Age 400 дней)
  Active --> Active: GET /api/session<br/>find_subject(token, USER) + active_user → authenticated: true,<br/>cookie переустановлена с новым Max-Age (ACC-03)
  Active --> Active: браузер закрыт и открыт снова<br/>(cookie постоянная)
  Active --> [*]: POST /api/logout<br/>delete_session: DELETE строки, cookie стёрта
  Active --> [*]: PATCH /api/admin/users/{id} {password} → 200 (ADM-04)<br/>или {disabled: true} → 200 (ADM-05)<br/>update_user: delete_subject_sessions(USER, id) — все сессии пользователя
  Active --> Orphaned: cookie истекла без визитов 400 дней
  Orphaned --> [*]
```

- Значение cookie — `secrets.token_urlsafe(32)`; в базе `id = sha256(token)`. Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` только при `PUBLIC_BASE_URL` на `https://`.
- Проверка учитывает `subject_type`: сессия пользователя досок не открывает панель администратора, cookie администратора не является сессией пользователя.
- Сессия пользователя принимается, только если учётка существует и не отключена (`active_user`).
- Любое поле `password` в `PATCH /api/admin/users/{id}` (даже прежнее значение) отзывает все сессии пользователя (ADM-04); смена только имени или почты их не трогает — выданная ранее сессия продолжает действовать и в `GET /api/session` видит новые данные.
- Отзыв идёт в той же транзакции, что и правка учётки, и до изменения полей: при отказе `409` (почта занята) не меняются ни пароль, ни сессии. Сессии других пользователей и администратора не затрагиваются.
- Отозванная сессия: `GET /api/session` → `200 {authenticated: false}`, маршруты с `require_user` → `401`. Открытая вкладка узнаёт об этом только при следующем обращении к API (опроса сессии нет, ACC-05 — T1.4).
- `expires_at` сейчас всегда `NULL`, срок сессии в базе не проверяется. Строка сессии, cookie которой браузер выбросил (`Orphaned`), остаётся в базе — очистки нет.

Актуально на: T1.3, b53b509. Требования: ADM-01, ADM-04, ADM-05, ACC-01, ACC-03.
