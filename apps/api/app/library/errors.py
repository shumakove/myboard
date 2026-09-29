"""Ответы об ошибках модуля library: чужое и несуществующее неразличимы (404)."""

from fastapi import HTTPException, status

BOARD_NOT_FOUND = "Board not found"
FOLDER_NOT_FOUND = "Folder not found"
FOLDER_CYCLE = "A folder cannot be moved into itself or its subfolder"


def not_found(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail)
