"""Временная заглушка api для T0.1: проверка маршрутизации Caddy.

Заменяется каркасом apps/api в T0.2.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "api-stub"}


@app.websocket("/api/ws")
async def echo(websocket: WebSocket) -> None:
    """Эхо: подтверждает, что WebSocket проходит через Caddy до api."""
    await websocket.accept()
    try:
        while True:
            await websocket.send_text(await websocket.receive_text())
    except WebSocketDisconnect:
        pass
