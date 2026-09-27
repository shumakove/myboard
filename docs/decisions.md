# Технические решения DEV

Библиотеки и инструменты, не названные в `ARCHITECTURE.md`, и почему они выбраны.

## 2026-09-27 · T0.1 · Образы и конфигурация стека

- **Образы**: `caddy:2.10-alpine` (фронтовой прокси и сервер статики заглушки `web`), `postgres:16-alpine`, `python:3.12-slim` (заглушка `api`). Версии зафиксированы по минорной ветке, чтобы сборка на пустых томах была воспроизводимой. Альтернатива для статики — nginx; не выбран, чтобы в стеке был один веб-сервер с одним синтаксисом конфигурации.
- **Запрет фрейма**: Caddy ставит `X-Frame-Options: DENY` и `Content-Security-Policy: frame-ancestors 'none'` на все ответы, кроме пути `^/b/[^/]+/embed/?$`. Два заголовка — для старых и новых браузеров. Заголовки ставятся на прокси (`defer`), поэтому действуют и для статики, и для API, и ответ upstream их не перезаписывает.
- **Переменные**: обязательные переменные в `compose.yaml` заданы через `${VAR:?...}` — `docker compose` не запускает стек без любой из них. Для PostgreSQL добавлены `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`; `DATABASE_URL` указывается целиком (драйвер `postgresql+psycopg` — предварительно, окончательно выбирается в T0.2).
- **Заглушки** `deploy/compose/stubs/{api,web}` — временные, только для проверки маршрутизации. Заглушка `api` — FastAPI + uvicorn из стека архитектуры (`/api/health`, эхо-WebSocket `/api/ws`). В T0.2 и T0.3 контекст сборки сменится на `apps/api` и `apps/web`, заглушки удаляются.

## 2026-09-27 · T0.2 · Каркас API

- **Зависимости и окружение**: `uv` с `pyproject.toml` и `uv.lock` в `apps/api` (`package = false` — приложение, не библиотека). В образе `uv` копируется из `ghcr.io/astral-sh/uv:0.8.2`, зависимости ставятся `uv sync --frozen --no-dev`. Альтернатива — pip + requirements.txt; не выбрана: нет lock-файла с хэшами.
- **Настройки**: `pydantic-settings`. Ошибка валидации переводится в `SettingsError` с именами переменных в верхнем регистре (`PUBLIC_BASE_URL: is required`); пустое значение приравнивается к отсутствующему. Точка входа `python -m app` печатает ошибку в stderr и завершается с кодом 1 до запуска Uvicorn. Альтернатива — ручной разбор `os.environ`; не выбрана: pydantic уже в стеке FastAPI и даёт типы.
- **База данных**: SQLAlchemy 2 (async) + драйвер `psycopg` 3 (`postgresql+psycopg://`). Один драйвер работает и в async-приложении, и в синхронном Alembic, поэтому `DATABASE_URL` один. Альтернатива — asyncpg; не выбран: Alembic пришлось бы запускать через отдельный sync-драйвер или async-обёртку. `MetaData` с `naming_convention` — стабильные имена ограничений в миграциях.
- **Миграции**: Alembic, каталог `app/migrations`, запуск `upgrade head` в lifespan приложения — Uvicorn открывает порт только после завершения lifespan, значит трафик принимается уже на мигрированной базе. Шаблон ревизии генерирует `downgrade()`, бросающий `NotImplementedError` (только вперёд). Базовая ревизия `0001` пустая; таблицы добавляют задачи модулей. Альтернатива — `alembic upgrade head && uvicorn` в команде контейнера; не выбрана: проверка «миграции до трафика» тогда не покрывается модульным тестом.
- **OpenAPI**: `/api/openapi.json`, Swagger UI — `/api/docs` (ReDoc отключён). Все маршруты под префиксом `/api`, как проксирует Caddy.
- **Тестовая БД**: `testcontainers` (`testcontainers.community.postgres`, образ `postgres:16-alpine`) поднимает PostgreSQL на сессию тестов; каждый тест получает отдельную пустую базу. Если задан `TEST_DATABASE_URL`, используется внешний сервер. Альтернатива — SQLite; не выбрана: схема и миграции должны проверяться на PostgreSQL. Клиент тестов — `fastapi.testclient` с `httpx2` (Starlette 1.x помечает `httpx` в TestClient устаревшим).
- **Проверки**: `ruff` (lint с наборами E, W, F, I, B, UP, N, SIM, RUF, ASYNC, S и format, длина строки 100), `mypy --strict` с плагином `pydantic.mypy`.
- **Заглушка `deploy/compose/stubs/api` удалена**: сервис `api` собирается из `apps/api`. Эхо-WebSocket `/api/ws` больше нет — канал появится в модуле `realtime` (T4.1); до тех пор рукопожатие `/api/ws` получает 403 от API.
