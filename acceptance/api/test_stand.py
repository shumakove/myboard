"""Служебные проверки самого стенда Q0.1 (не приёмка требований)."""

from __future__ import annotations

import pytest

from stand import StandConfigError, public_base_url, ws_url


def test_stand_public_base_url_responds(client) -> None:
    """Стек по PUBLIC_BASE_URL отдаёт любой HTTP-ответ."""
    response = client.http.get("/")
    assert 100 <= response.status_code < 600


def test_stand_two_clients_have_separate_cookies(two_clients) -> None:
    a, b = two_clients
    a.http.cookies.set("probe", "a")
    assert "probe" not in b.http.cookies


def test_stand_ws_url_built_from_base() -> None:
    assert ws_url("http://192.168.1.20:8080") == "ws://192.168.1.20:8080/api/ws"
    assert ws_url("https://board.example.org") == "wss://board.example.org/api/ws"


@pytest.mark.parametrize("value", ["", "http://localhost", "http://127.0.0.1:8080", "ftp://10.0.0.1"])
def test_stand_rejects_bad_public_base_url(monkeypatch, value: str) -> None:
    monkeypatch.setenv("PUBLIC_BASE_URL", value)
    with pytest.raises(StandConfigError):
        public_base_url()
