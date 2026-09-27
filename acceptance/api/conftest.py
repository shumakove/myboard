"""Фикстуры приёмочного стенда QA (Q0.1).

Запуск: `cd acceptance/api && PUBLIC_BASE_URL=http://<IP в LAN> uv run pytest`.
Стек QA перед прогоном поднимается с нуля:
`docker compose -p myboard-qa down -v && docker compose -p myboard-qa up --build`.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest

from admin_helpers import admin_credentials, create_user, login
from stand import Client, StandConfigError, clients, pending, public_base_url
from user_helpers import user_login


@pytest.fixture(scope="session")
def base_url() -> str:
    """Базовый адрес стека — только из PUBLIC_BASE_URL."""
    try:
        return public_base_url()
    except StandConfigError as exc:
        pytest.fail(str(exc), pytrace=False)


@pytest.fixture(scope="session")
def clean_stack(base_url: str) -> str:
    """«Чистый стек»: стек QA, поднятый с нуля, отвечает по PUBLIC_BASE_URL.

    Чистоту томов обеспечивает запуск с `down -v`; фикстура проверяет, что стек
    доступен, и возвращает базовый адрес.
    """
    try:
        httpx.get(base_url + "/", timeout=10.0, follow_redirects=False)
    except httpx.HTTPError as exc:
        pytest.fail(f"Стек не отвечает по {base_url}: {exc!r}", pytrace=False)
    return base_url


@pytest.fixture
def client(clean_stack: str) -> Iterator[Client]:
    """Один независимый клиент (анонимный, без cookie)."""
    with clients(clean_stack, "client") as (one,):
        yield one


@pytest.fixture
def two_clients(clean_stack: str) -> Iterator[tuple[Client, Client]]:
    """Два независимых клиента со своими cookie — для совместной работы."""
    with clients(clean_stack, "A", "B") as (a, b):
        yield a, b


@pytest.fixture(scope="session")
def admin_creds() -> tuple[str, str]:
    """ADMIN_EMAIL/ADMIN_PASSWORD, с которыми поднят стек QA."""
    try:
        return admin_credentials()
    except RuntimeError as exc:
        pytest.fail(str(exc), pytrace=False)


@pytest.fixture
def admin(clean_stack: str, admin_creds: tuple[str, str]) -> Iterator[Client]:
    """Клиент, вошедший как администратор из ADMIN_EMAIL/ADMIN_PASSWORD (ADM-01, T1.1)."""
    with clients(clean_stack, "admin") as (one,):
        resp = login(one, *admin_creds)
        assert resp.status_code == 204, (resp.status_code, resp.text)
        yield one


@pytest.fixture
def board_user(admin: Client, clean_stack: str) -> Iterator[Client]:
    """Пользователь досок: создан администратором и вошёл через `POST /api/login` (ADM-03, ACC-01).

    Данные учётки — в `client.account` (id, name, email, `_password`).
    """
    account = create_user(admin)
    with clients(clean_stack, "board_user") as (one,):
        resp = user_login(one, account["email"], account["_password"])
        assert resp.status_code == 204, (resp.status_code, resp.text)
        one.account = account  # type: ignore[attr-defined]
        yield one


@pytest.fixture
def board(board_user: Client) -> dict[str, str]:
    """Доска пользователя досок (BRD-01)."""
    pending("доска", "T2.1")
    raise AssertionError("недостижимо")


@pytest.fixture
def link_participant(board: dict[str, str], clean_stack: str) -> Client:
    """Участник по ссылке: вошёл по /b/{token} и назвал имя (SHR-02, SHR-03)."""
    pending("участник по ссылке", "T3.1")
    raise AssertionError("недостижимо")
