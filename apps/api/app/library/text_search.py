"""Поиск по части названия (BRD-06) — общий для досок и папок."""


def contains(text: str) -> str:
    """Шаблон ILIKE «содержит»: `%`, `_` и `\\` в запросе ищутся буквально."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
