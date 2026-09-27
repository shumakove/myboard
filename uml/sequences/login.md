# Вход

Реализован вход администратора в панель (T1.1). Вход пользователя досок (`/login`, ACC-*) появится в T1.2.

## Вход администратора

```mermaid
sequenceDiagram
  autonumber
  actor A as Администратор
  participant P as AdminLoginPage (/admin/login)
  participant C as adminApi (openapi-fetch)
  participant R as identity.router
  participant L as LoginRateLimiter
  participant S as identity.service
  participant H as identity.passwords
  participant SS as identity.sessions
  participant DB as PostgreSQL

  P->>R: GET /api/admin/session (useAdminSession)
  R->>SS: find_subject(cookie myboard_admin, ADMIN)
  R-->>P: 200 {authenticated: false, email: null}
  A->>P: Email, Password, Sign in
  P->>C: signIn(email, password)
  C->>R: POST /api/admin/login {email, password}
  R->>L: retry_after(адрес клиента)
  alt 10 неудач за 60 с с этого адреса
    R-->>C: 429 "Too many sign-in attempts, try again later", Retry-After
    C-->>P: AdminApiError → Too many sign-in attempts. Try again later.
  else попытка разрешена
    R->>S: authenticate_admin(db, email, password)
    S->>DB: SELECT admins WHERE email = lower(strip(email))
    S->>H: verify_password(hash или None, password)
    Note over H: Argon2id в пуле потоков, при отсутствии учётки — проверка по фиктивному хэшу
    alt нет администратора или неверный пароль (в т.ч. почта пользователя досок)
      R->>L: record_failure(адрес)
      R-->>C: 401 "Invalid email or password"
      C-->>P: AdminApiError → Invalid email or password.
    else верно
      R->>SS: create_session(db, ADMIN, admin.id)
      SS->>DB: INSERT sessions (id = sha256(token), subject_type = admin)
      R-->>C: 204, Set-Cookie myboard_admin (HttpOnly, SameSite=Lax, Path=/, Secure при https://)
      P->>P: navigate(/admin/users)
    end
  end
```

## Доступ к панели и выход

```mermaid
sequenceDiagram
  autonumber
  participant U as AdminUsersPage (/admin/users)
  participant R as identity.router
  participant SS as identity.sessions
  participant DB as PostgreSQL

  U->>R: GET /api/admin/session
  R->>SS: find_subject(cookie, ADMIN)
  SS->>DB: SELECT subject_id FROM sessions WHERE id = sha256(cookie) AND subject_type = admin
  alt сессии нет
    R-->>U: 200 {authenticated: false}
    Note over U: Sign in as an administrator… + ссылка Sign in
  else сессия есть
    R-->>U: 200 {authenticated: true, email}
    U->>R: GET /api/admin/users (require_admin)
    R-->>U: 200 [UserOut]
  end
  Note over R: любой /api/admin/users* без сессии администратора → 401 "Sign in as administrator"
  U->>R: POST /api/admin/logout (Sign out)
  R->>SS: delete_session(cookie)
  SS->>DB: DELETE sessions WHERE id = sha256(cookie)
  R-->>U: 204, cookie myboard_admin стёрта
  U->>U: navigate(/admin/login)
```

- `/admin` перенаправляет на `/admin/users`; `/admin/login` при действующей сессии перенаправляет туда же.
- Отказ одинаков для неизвестной почты, неверного пароля и учётки пользователя досок; формат почты при входе не проверяется.
- Адрес клиента для лимита — `request.client.host`, который Uvicorn берёт из `X-Forwarded-For` от Caddy (`proxy_headers=True`). Счётчики в памяти процесса.

Актуально на: T1.1, 97556a8. Требования: ADM-01.
