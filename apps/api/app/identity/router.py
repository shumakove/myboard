"""Маршруты модуля identity: панель администратора и вход пользователя досок."""

from fastapi import APIRouter

from app.identity.account_router import router as account_router
from app.identity.admin_router import router as admin_router

router = APIRouter()
router.include_router(admin_router)
router.include_router(account_router)
