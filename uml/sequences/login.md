# Вход

Реализованы вход администратора в панель (T1.1) и вход пользователя досок на `/login` (T1.2). Маршруты панели — `identity.admin_router`, маршруты пользователя — `identity.account_router`; общие части (лимит, скупой отказ) — `identity.http`.

## Вход администратора

```mermaid
sequenceDiagram
  autonumber
  actor A as Администратор
  participant P as AdminLoginPage (/admin/login)
  participant C as adminApi (openapi-fetch)
  participant R as identity.admin_router
  participant L as admin_login_limiter
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
  participant R as identity.admin_router
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

## Вход пользователя досок

```mermaid
sequenceDiagram
  autonumber
  actor U as Пользователь досок
  participant P as LoginPage (/login)
  participant C as accountApi (openapi-fetch)
  participant R as identity.account_router
  participant L as user_login_limiter
  participant S as identity.service
  participant H as identity.passwords
  participant SS as identity.sessions
  participant DB as PostgreSQL

  P->>R: GET /api/session (useAccountSession)
  R->>SS: find_subject(cookie myboard_session, USER)
  alt сессия есть и учётка не отключена
    R-->>P: 200 {authenticated: true, name, email}
    P->>P: Redirect / (ACC-03)
  else
    R-->>P: 200 {authenticated: false, name: null, email: null}
  end
  U->>P: Email, Password, Sign in
  P->>C: signIn(email, password)
  C->>R: POST /api/login {email, password}
  R->>L: retry_after(адрес клиента)
  alt 10 неудач за 60 с с этого адреса
    R-->>C: 429 "Too many sign-in attempts, try again later", Retry-After
    C-->>P: AccountApiError → Too many sign-in attempts. Try again later.
  else попытка разрешена
    R->>S: authenticate_user(db, email, password)
    S->>DB: SELECT users WHERE email = lower(strip(email))
    S->>H: verify_password(hash или None, password)
    Note over S: пароль проверяется и у отключённой учётки — время отказа одинаково
    alt нет учётки, неверный пароль, disabled или данные администратора
      R->>L: record_failure(адрес)
      R-->>C: 401 "Invalid email or password"
      C-->>P: AccountApiError → Invalid email or password. (ACC-02)
    else верно
      R->>SS: create_session(db, USER, user.id)
      SS->>DB: INSERT sessions (id = sha256(token), subject_type = user)
      R-->>C: 204, Set-Cookie myboard_session (HttpOnly, SameSite=Lax, Path=/, Max-Age=34560000, Secure при https://)
      P->>P: navigate(/)
    end
  end
```

## Список досок и выход пользователя

```mermaid
sequenceDiagram
  autonumber
  participant B as BoardsPage (/)
  participant R as identity.account_router
  participant S as identity.service
  participant SS as identity.sessions
  participant DB as PostgreSQL

  B->>R: GET /api/session
  R->>SS: find_subject(cookie, USER)
  SS->>DB: SELECT subject_id FROM sessions WHERE id = sha256(cookie) AND subject_type = user
  R->>S: active_user(db, subject_id)
  alt нет сессии или учётка отключена
    R-->>B: 200 {authenticated: false}
    B->>B: Redirect /login
  else
    R-->>B: 200 {authenticated: true, name, email}, Set-Cookie myboard_session с новым Max-Age
    Note over B: Boards, имя, Sign out
  end
  B->>R: POST /api/logout (Sign out)
  R->>SS: delete_session(cookie)
  SS->>DB: DELETE sessions WHERE id = sha256(cookie)
  R-->>B: 204, cookie myboard_session стёрта
  B->>B: navigate(/login)
```

- Отказ одинаков для неизвестной почты, неверного пароля, отключённой учётки и данных администратора; пустые или отсутствующие поля — `422`, интерфейс показывает тот же текст.
- Лимит входа пользователя досок считается отдельно от лимита входа в панель.
- Выход в одном браузере отзывает только его сессию; скопированная ранее cookie после выхода не действует.

Актуально на: T1.2, f65eab9. Требования: ADM-01, ACC-01, ACC-02, ACC-03.
