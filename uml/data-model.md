# Модель данных PostgreSQL

Фактические таблицы в `main`. Миграции Alembic только вперёд: `0001` (пустая), `0002_identity` (T1.1), `0003_library_boards` (T2.1); вход пользователя досок (T1.2) новых таблиц не добавил. Модели SQLAlchemy — `app.identity.models` и `app.library.models`, базовый класс `app.core.db.Base` с соглашением об именах ограничений (`pk_%(table)s`, `uq_%(table)s_%(column)s`, `ix_%(column_label)s`, `fk_%(table)s_%(column)s_%(referred_table)s`).

```mermaid
erDiagram
  admins {
    uuid id PK "pk_admins"
    varchar_254 email UK "uq_admins_email, нижний регистр"
    varchar password_hash "Argon2id"
    timestamptz created_at "server_default now()"
  }
  users {
    uuid id PK "pk_users"
    varchar_254 email UK "uq_users_email, нижний регистр (ADM-07)"
    varchar_200 name
    varchar password_hash "Argon2id"
    boolean disabled "server_default false (ADM-05, ADM-06)"
    timestamptz created_at "server_default now()"
  }
  sessions {
    varchar_64 id PK "SHA-256 (hex) значения cookie"
    varchar_16 subject_type "admin (myboard_admin) или user (myboard_session)"
    uuid subject_id "ix_sessions_subject_id"
    timestamptz expires_at "nullable, пока не заполняется"
    timestamptz created_at "server_default now()"
  }
  boards {
    uuid id PK "pk_boards"
    uuid owner_id FK "fk_boards_owner_id_users, ix_boards_owner_id"
    varchar_200 title "Untitled board по умолчанию (BRD-01)"
    timestamptz created_at "server_default now() (BRD-05)"
    timestamptz updated_at "server_default now(), now() при переименовании (BRD-04, BRD-05)"
    timestamptz deleted_at "nullable, пометка удаления (BRD-03)"
  }
  admins ||--o{ sessions : "subject_type = admin"
  users ||--o{ sessions : "subject_type = user"
  users ||--o{ boards : "owner_id"
```

- Связь `sessions → admins/users` полиморфная (`subject_type` + `subject_id`), внешнего ключа в базе нет.
- `sessions.id` — не само значение cookie, а его SHA-256: cookie содержит `secrets.token_urlsafe(32)`, утечка таблицы не даёт готовых cookie.
- Почта нормализуется до записи (`strip().lower()`), поэтому `uq_users_email` отклоняет повтор без учёта регистра; нарушение ограничения превращается в `EmailTakenError` → `409`.
- Первый администратор вставляется при старте, только если `admins` пуста (`ensure_first_admin`, из `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
- Строку `sessions` с `subject_type = user` создаёт `POST /api/login`, удаляет `POST /api/logout`. Сессия пользователя в базе бессрочна (ACC-03): срок `Max-Age` 400 дней есть только у cookie и продлевается `GET /api/session`.
- Отключение пользователя (`disabled = true`) удаляет его строки из `sessions` в той же транзакции; кроме того, сессия отключённого пользователя не принимается (`active_user`).
- `boards.owner_id` ссылается на `users.id` без каскада; строки `users` не удаляются, поэтому доски отключённого пользователя остаются (ADM-05).
- Каждый запрос модуля `library` отбирает только живые доски владельца (`_owned`: `owner_id = :user AND deleted_at IS NULL`); чужая, удалённая и несуществующая доска неразличимы (`404`).
- Удаление доски (BRD-03) только ставит `deleted_at = now()`: строка остаётся, в списках и по `id` не видна. Переименование (BRD-02) ставит `updated_at = now()`; создание заполняет обе даты из базы.
- Поиск (BRD-06) — `title ILIKE '%…%'` с экранированием `%`, `_`, `\`; фильтр (BRD-05) — `updated_at >= modified_since`; порядок (BRD-05) — `updated_at DESC`, `created_at DESC` или `lower(title) ASC`, при равенстве `id ASC`. «Недавние» (BRD-04) — первые 8 по `updated_at DESC`.
- Столбцов папки, избранного, обложки и токенов ссылок в `boards`, столбцов `sessions.board_id` и `sessions.display_name` (сессия участника по ссылке), таблиц `folders`, `board_updates`, `board_snapshots` пока нет — появятся в задачах T2.2, T3.1, T4.* и далее.

Актуально на: T2.1, facb370. Требования: ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06, ADM-07, ACC-01, ACC-03, ACC-04, BRD-01, BRD-02, BRD-03, BRD-04, BRD-05, BRD-06.
