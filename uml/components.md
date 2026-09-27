# Компоненты

Фактическое устройство кода приложения. Пока реализован только каркас сервера `apps/api` (T0.2); модули клиента `apps/web` появятся со схемой после приёмки T0.3.

## Сервер `apps/api`

```mermaid
flowchart TB
  entry["app.__main__.main()<br/>python -m app"]
  subgraph core [app.core]
    settings["settings<br/>Settings, load_settings(), SettingsError"]
    db["db<br/>Base (NAMING_CONVENTION), create_engine(),<br/>create_session_factory(), get_session / SessionDep"]
    migrations["migrations<br/>alembic_config(), upgrade_to_head()"]
    health["health.router<br/>GET /health → Health"]
  end
  main["app.main<br/>create_app(settings), lifespan,<br/>API_PREFIX = /api, MODULE_ROUTERS"]
  subgraph modules [Модули: пустые APIRouter, маршрутов пока нет]
    identity[identity.router]
    library[library.router]
    sharing[sharing.router]
    realtime[realtime.router]
    history[history.router]
    media[media.router]
    backup[backup.router]
  end
  alembic["app.migrations<br/>env.py, versions/0001_baseline"]
  pg[(PostgreSQL)]

  entry -->|"1. load_settings()<br/>ошибка → stderr, exit 1"| settings
  entry -->|"2. create_app(settings)"| main
  entry -->|"3. uvicorn.run :8000"| main
  main -->|"lifespan: upgrade_to_head()<br/>до приёма трафика"| migrations
  migrations --> alembic
  alembic -->|"target_metadata = Base.metadata"| db
  main -->|"lifespan: engine, app.state.session_factory"| db
  main -->|"include_router(prefix=/api)"| health
  main -->|"include_router(prefix=/api)"| modules
  health -->|"SessionDep: SELECT 1"| db
  db -->|"SQLAlchemy async, psycopg 3"| pg
  alembic -->|"синхронный движок psycopg"| pg
```

- Все маршруты под префиксом `/api`: `GET /api/health` (`{"status":"ok"}`), `GET /api/openapi.json` (OpenAPI 3.1), `GET /api/docs` (Swagger UI). Неизвестный путь `/api/*` — `404` JSON.
- `Settings` — семь обязательных переменных (`PUBLIC_BASE_URL`, `SECRET_KEY`, `DATABASE_URL`, `MEDIA_ROOT`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MAX_UPLOAD_BYTES`); пустое значение равно отсутствию. `MAX_UPLOAD_BYTES` > 0, `PUBLIC_BASE_URL` — `http://` или `https://`; свойство `secure_cookies` истинно только для `https://`.
- Миграции только вперёд: ревизия `0001` пустая, `downgrade()` бросает `NotImplementedError`.
- WebSocket `/api/ws` не реализован (появится в T4.1).

Актуально на: T0.2, 9bce527. Требования: — (ARCHITECTURE.md, разделы 3, 5, 7, 11: модули сервера, OpenAPI, Alembic, обязательные переменные).
