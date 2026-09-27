"""Фикстуры приёмочного стенда QA (Q0.1).

Запуск: `cd acceptance/api && PUBLIC_BASE_URL=http://<IP в LAN> uv run pytest`.
Стек QA перед прогоном поднимается с нуля:
`docker compose -p myboard-qa down -v && docker compose -p myboard-qa up --build`.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest

from stand import Client, StandConfigError, clients, pending, public_base_url


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


@pytest.fixture
def admin(clean_stack: str) -> Client:
    """Клиент, вошедший как администратор из ADMIN_EMAIL/ADMIN_PASSWORD (ADM-01)."""
    pending("админ", "T1.1")
    raise AssertionError("недостижимо")


@pytest.fixture
def board_user(admin: Client) -> Client:
    """Пользователь досок: создан администратором и вошёл через /login (ADM-03, ACC-01)."""
    pending("пользователь досок", "T1.1 и T1.2")
    raise AssertionError("недостижимо")


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
