# Компоненты

Фактическое устройство кода приложения. Реализованы каркас сервера `apps/api` (T0.2) и каркас интерфейса `apps/web` (T0.3): таблица маршрутов со страницами-заглушками, типизированный HTTP-клиент и адрес WebSocket.

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

Актуально на: T0.2, 9bce527 (сервер не менялся в T0.3, сверено на 03e00fa). Требования: — (ARCHITECTURE.md, разделы 3, 5, 7, 11: модули сервера, OpenAPI, Alembic, обязательные переменные).

## Клиент `apps/web`

```mermaid
flowchart TB
  html["index.html<br/>div#root"]
  main["main.tsx<br/>createRoot(#root), StrictMode"]
  routes["routes.tsx<br/>AppRoutes: wouter Switch / Route"]
  subgraph pages [pages: заглушки, кроме NotFoundPage]
    placeholder["PagePlaceholder({title})<br/>h1 + This page is not available yet."]
    login["LoginPage<br/>/login"]
    boards["BoardsPage<br/>/"]
    board["BoardPage<br/>/boards/:id"]
    templates["TemplatesPage<br/>/templates"]
    tcopy["TemplateCopyPage<br/>/t/:token"]
    alogin["AdminLoginPage<br/>/admin/login"]
    ausers["AdminUsersPage<br/>/admin/users"]
    shared["SharedBoardPage<br/>/b/:token"]
    embed["EmbeddedBoardPage<br/>/b/:token/embed"]
    nf["NotFoundPage<br/>любой другой путь: Page not found"]
  end
  subgraph apiMod [api]
    client["client.ts<br/>createApiClient(origin = window.location.origin),<br/>api = openapi-fetch createClient&lt;paths&gt;"]
    schema["schema.d.ts<br/>paths, components, operations<br/>(openapi-typescript)"]
  end
  subgraph realtimeMod [realtime]
    sock["socketUrl.ts<br/>socketUrl(page = window.location):<br/>https: → wss:, иначе ws:; host страницы + /api/ws"]
  end
  oas["openapi.json<br/>pnpm api:fetch ← $PUBLIC_BASE_URL/api/openapi.json"]
  server["apps/api: /api/*"]

  html --> main --> routes
  routes --> login & boards & board & templates & tcopy & alogin & ausers & shared & embed & nf
  login & boards & board & templates & tcopy & alogin & ausers & shared & embed --> placeholder
  client -->|"import type paths"| schema
  oas -->|"pnpm api:types"| schema
  client -->|"HTTP к происхождению страницы, пути /api/…"| server
```

- Страницы пока не используют `api` и `socketUrl`: модули готовы для задач T1.1 и далее. В `schema.d.ts` сейчас один путь — `GET /api/health`.
- Адреса API и WebSocket строятся из адреса страницы (`window.location`), `localhost` в клиенте нет; тестовая среда Vitest (jsdom) открыта по `http://192.168.1.20:8080/`.
- Параметр `?object={id}` на `/b/{token}` отдельным маршрутом не выделен — его прочитает страница доски.
- Сборка: `pnpm build` = `tsc --noEmit && vite build` (плагин `@vitejs/plugin-react`), результат `dist` раздаёт сервис `web` (см. [deployment.md](deployment.md)).

Актуально на: T0.3, 03e00fa. Требования: — (ARCHITECTURE.md, разделы 3, 4, 10: SPA, таблица маршрутов, типы из OpenAPI, адреса из адреса страницы).
