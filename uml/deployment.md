# Развёртывание

Фактическое устройство стека Docker Compose (`deploy/compose/compose.yaml`, `deploy/compose/Caddyfile`). Реализован только профиль локальной сети; публичный профиль с HTTPS (`SITE_DOMAIN`, порт 443) — задача T11.2.

## Сервисы, тома и порты (профиль LAN)

```mermaid
flowchart TB
  phone[Телефон / компьютер в LAN]
  subgraph host [Машина разработчика]
    port["0.0.0.0:${HTTP_PORT:-80}"]
    subgraph compose [Проект Compose: myboard-dev / myboard-qa]
      caddy["caddy<br/>caddy:2.10-alpine<br/>:80, auto_https off"]
      web["web<br/>build: ../../apps/web<br/>node:24-alpine: pnpm build (Vite) →<br/>caddy:2.10-alpine file_server :80, root /srv<br/>try_files {path} /index.html"]
      api["api<br/>build: ../../apps/api<br/>python -m app, uvicorn :8000<br/>GET /api/health (SELECT 1)"]
      postgres["postgres<br/>postgres:16-alpine :5432"]
    end
    vpg[(pgdata)]
    vmedia[(media)]
    vcdata[(caddy_data)]
    vcconf[(caddy_config)]
  end

  phone -->|"HTTP, PUBLIC_BASE_URL"| port
  port --> caddy
  caddy -->|"path /api, /api/*"| api
  caddy -->|"всё остальное"| web
  api -. "depends_on: service_healthy" .-> postgres
  api -->|"DATABASE_URL: миграции, запросы"| postgres
  caddy -. "depends_on: web started, api healthy" .-> api
  postgres --- vpg
  api ---|"смонтирован в ${MEDIA_ROOT}"| vmedia
  caddy --- vcdata
  caddy --- vcconf
```

- `web` — образ из `apps/web`: стадия сборки `node:24-alpine` (`pnpm install --frozen-lockfile`, `pnpm build` = `tsc --noEmit && vite build`), стадия раздачи `caddy:2.10-alpine` со своим `apps/web/Caddyfile` отдаёт `dist` из `/srv`; любой путь без файла получает `index.html` (маршруты SPA).
- `api` — образ из `apps/api` (Python 3.12, зависимости из `uv.lock`). При старте проверяет обязательные переменные (без любой — выход с кодом 1) и применяет миграции Alembic в `postgres` до приёма трафика; `GET /api/health` выполняет `SELECT 1`. WebSocket `/api/ws` пока не реализован — маршрут Caddy для него уже есть.
- Порт на машине задаёт `HTTP_PORT`: 80 — стек QA (`-p myboard-qa`), 8080 — стек DEV (`-p myboard-dev`).
- Проверки готовности: `api` — `GET http://127.0.0.1:8000/api/health`, `postgres` — `pg_isready`.

## Переменные окружения

```mermaid
flowchart LR
  env[".env (шаблон .env.example)"]
  env -->|"HTTP_PORT (необязательна, по умолчанию 80)"| caddy[caddy: ports]
  env -->|"PUBLIC_BASE_URL, SECRET_KEY, DATABASE_URL, MEDIA_ROOT,<br/>ADMIN_EMAIL, ADMIN_PASSWORD, MAX_UPLOAD_BYTES<br/>(обязательны: ${VAR:?...})"| api[api: environment]
  env -->|"SNAPSHOT_INTERVAL_SECONDS<br/>(необязательна, по умолчанию 300, T4.3)"| api
  env -->|"POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD<br/>(обязательны)"| postgres[postgres: environment]
  env -->|"MEDIA_ROOT"| vol[точка монтирования тома media]
```

Без любой обязательной переменной `docker compose` отказывается запускать стек и называет переменную. `SITE_DOMAIN` в шаблоне закомментирована (T11.2).

## Заголовки против показа во фрейме

```mermaid
flowchart TB
  req[Запрос к caddy] --> m{"path_regexp ^/b/[^/]+/embed/?$"}
  m -->|да| pass[Ответ без запрета фрейма]
  m -->|нет| deny["header defer:<br/>X-Frame-Options: DENY<br/>Content-Security-Policy: frame-ancestors 'none'"]
  pass --> route{"path /api или /api/*"}
  deny --> route
  route -->|да| api[reverse_proxy api:8000]
  route -->|нет| web[reverse_proxy web:80]
```

Заголовки ставятся на все ответы (статика и API), кроме `/b/{token}/embed` и `/b/{token}/embed/`.

Актуально на: T0.3, 03e00fa; переменная `SNAPSHOT_INTERVAL_SECONDS` — T4.3, 7477309. Требования: EMB-04 (часть: фрейм только для `/b/{token}/embed`); ARCHITECTURE.md, разделы 11–12 (сервисы, тома, обязательные переменные, профиль LAN).
