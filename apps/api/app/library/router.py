"""Маршруты модуля library: доски и папки пользователя."""

from fastapi import APIRouter

from app.library.board_router import router as board_router
from app.library.folder_router import router as folder_router

router = APIRouter()
router.include_router(board_router)
router.include_router(folder_router)
