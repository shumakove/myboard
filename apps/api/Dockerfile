# Образ api: Python 3.12, зависимости из uv.lock. Процесс сам проверяет
# обязательные переменные и применяет миграции до приёма трафика.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.2 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY alembic.ini ./
COPY app ./app

EXPOSE 8000
CMD ["python", "-m", "app"]
