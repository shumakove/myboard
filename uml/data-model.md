# Модель данных PostgreSQL

Фактические таблицы в `main`. Миграции Alembic только вперёд: `0001` (пустая), `0002_identity` (T1.1). Модели SQLAlchemy — `app.identity.models`, базовый класс `app.core.db.Base` с соглашением об именах ограничений (`pk_%(table)s`, `uq_%(table)s_%(column)s`, `ix_%(column_label)s`).

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
    varchar_16 subject_type "admin или user (SubjectType)"
    uuid subject_id "ix_sessions_subject_id"
    timestamptz expires_at "nullable, пока не заполняется"
    timestamptz created_at "server_default now()"
  }
  admins ||--o{ sessions : "subject_type = admin"
  users ||--o{ sessions : "subject_type = user"
```

- Связь `sessions → admins/users` полиморфная (`subject_type` + `subject_id`), внешнего ключа в базе нет.
- `sessions.id` — не само значение cookie, а его SHA-256: cookie содержит `secrets.token_urlsafe(32)`, утечка таблицы не даёт готовых cookie.
- Почта нормализуется до записи (`strip().lower()`), поэтому `uq_users_email` отклоняет повтор без учёта регистра; нарушение ограничения превращается в `EmailTakenError` → `409`.
- Первый администратор вставляется при старте, только если `admins` пуста (`ensure_first_admin`, из `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
- Отключение пользователя (`disabled = true`) удаляет его строки из `sessions` в той же транзакции.
- Столбцов `sessions.board_id` и `sessions.display_name` (сессия участника по ссылке) и таблиц досок пока нет — появятся в задачах T2.1, T3.1 и далее.

Актуально на: T1.1, 97556a8. Требования: ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06, ADM-07.
