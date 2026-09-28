# UML-схемы проекта

Схемы описывают **принятую и протестированную реализацию** — то, что лежит в `main` и прошло приёмку QA. Целевое устройство описано в [ARCHITECTURE.md](../ARCHITECTURE.md); здесь — фактическое. Пока задача не принята, её изменения в схемы не попадают.

## Правила

- Схемы обновляет только DEV — после того как QA перевёл задачу в `ACCEPTED`, в ветке `uml/<TASK-ID>`. Задача получает `DONE` только после обновления схем ([WORKFLOW.md](../WORKFLOW.md), раздел 4.4).
- Источник схемы — код в `main`, а не план задачи. Расхождение с `ARCHITECTURE.md` записывается вопросом в `docs/questions.md`.
- Формат — Mermaid внутри `.md`: рендерится на GitHub и в редакторе без отдельных инструментов, как схемы в `ARCHITECTURE.md`.
- Один файл — одна тема. Имена сущностей, модулей, маршрутов и сообщений совпадают с кодом.
- Под схемой — строка «Актуально на: <TASK-ID>, <sha>» и ID требований, которые схема покрывает.
- Схемы без реализации не рисуются: новый файл появляется вместе с первой принятой задачей, которая его затрагивает.

## Структура

| Файл | Тип диаграммы | Что показывает |
| --- | --- | --- |
| `deployment.md` | deployment (flowchart) | Сервисы Compose, тома, порты, профили LAN и HTTPS |
| `components.md` | component (flowchart) | Модули `apps/api`, основные модули `apps/web` и связи между ними |
| `data-model.md` | class / ER | Таблицы PostgreSQL и связи |
| `board-document.md` | class | Документ Yjs: `objects`, `trash`, `comments`, `timer`, `votes`, `notes`, типы объектов сцены |
| `ws-protocol.md` | class + sequence | Сообщения WebSocket `sync`, `awareness`, `presence` |
| `sequences/<flow>.md` | sequence | Сценарии: вход, вход по ссылке, сброс ссылки, синхронизация, загрузка файла, резервная копия, восстановление |
| `states/<entity>.md` | state | Жизненные циклы: сессия, ссылка доски, учётная запись, объект (объекты → корзина) |

## Какие схемы обновляет задача

| Задачи PLAN.md | Схемы |
| --- | --- |
| T0.1, T0.2, T0.3, T11.2 | `deployment.md` |
| T0.2, T0.3 | `components.md` |
| T1.1, T1.2 | `data-model.md`, `components.md`, `sequences/login.md`, `states/session.md`, `states/user-account.md` |
| T1.3 | `states/session.md`, `states/user-account.md` |
| T2.1, T2.2 | `data-model.md`, `components.md` |
| T3.1 | `data-model.md`, `sequences/link-join.md`, `sequences/link-reset.md`, `states/share-link.md`, `states/session.md` |
| T4.1…T4.3 | `ws-protocol.md`, `board-document.md`, `data-model.md`, `sequences/sync.md`, `states/board-object.md` |
| T5.*, T6.* | `board-document.md` (типы объектов и их поля), `components.md` (модули холста и инструментов) |
| T7.* | `data-model.md`, `board-document.md`, `sequences/media-upload.md` |
| T8.1 | `board-document.md` |
| T8.2 | `data-model.md`, `sequences/history-restore.md` |
| T9.1 | `data-model.md`, `sequences/template-copy.md` |
| T10.1 | `sequences/backup.md`, `sequences/backup-restore.md` |
| T10.2 | `components.md` |

Если принятая реализация затронула схему, которой нет в таблице, DEV обновляет и её, а таблицу дополняет.

## Реестр

| Схема | Актуально на |
| --- | --- |
| [deployment.md](deployment.md) | T0.3, 03e00fa |
| [components.md](components.md) | T1.2, f65eab9 |
| [data-model.md](data-model.md) | T1.2, f65eab9 |
| [sequences/login.md](sequences/login.md) | T1.2, f65eab9 |
| [states/session.md](states/session.md) | T1.3, b53b509 |
| [states/user-account.md](states/user-account.md) | T1.3, b53b509 |
