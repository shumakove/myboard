# Матрица трассируемости

ID требования из [REQUIREMENTS.md](../../REQUIREMENTS.md) → задача из [PLAN.md](../../PLAN.md) → приёмочный тест → вердикт. Ведёт QA; вердикт обновляется после каждой приёмки (WORKFLOW.md, 6.2).

Вердикты: `не проверено`, `PASS`, `FAIL (BUG-NNN)`, `BLOCKED (Q-NNN)`.

| Требование | Задача | Приёмочный тест | Вердикт |
| --- | --- | --- | --- |
| ADM-01 | T1.1 | acceptance/api/test_admin.py::test_adm01_*, acceptance/e2e/admin.spec.ts | PASS |
| ADM-02 | T1.1 | acceptance/api/test_admin.py::test_adm02_*, acceptance/e2e/admin.spec.ts | PASS |
| ADM-03 | T1.1 | acceptance/api/test_admin.py::test_adm03_*, acceptance/e2e/admin.spec.ts | PASS |
| ADM-04 | T1.1, T1.2, T1.3 | acceptance/api/test_admin.py::test_adm04_*, acceptance/api/test_login.py::test_adm04_*, acceptance/api/test_session_revoke.py::test_adm04_*, acceptance/e2e/admin.spec.ts, acceptance/e2e/login.spec.ts, acceptance/e2e/session-revoke.spec.ts | PASS (в т.ч. отзыв сессий при смене пароля, T1.3) |
| ADM-05 | T1.1, T1.2 | acceptance/api/test_admin.py::test_adm05_*, acceptance/api/test_login.py::test_adm05_*, acceptance/e2e/admin.spec.ts, acceptance/e2e/login.spec.ts, acceptance/api/test_boards.py::test_adm05_*, acceptance/e2e/boards.spec.ts (ADM-05) | PASS (сохранность досок проверена в T2.1) |
| ADM-06 | T1.1, T1.2 | acceptance/api/test_admin.py::test_adm06_*, acceptance/api/test_login.py::test_adm06_*, acceptance/e2e/admin.spec.ts, acceptance/e2e/login.spec.ts | PASS |
| ADM-07 | T1.1 | acceptance/api/test_admin.py::test_adm07_*, acceptance/e2e/admin.spec.ts | PASS |
| ACC-01 | T1.2 | acceptance/api/test_login.py::test_acc01_*, acceptance/e2e/login.spec.ts | PASS |
| ACC-02 | T1.2 | acceptance/api/test_login.py::test_acc02_*, acceptance/e2e/login.spec.ts | PASS |
| ACC-03 | T1.2 | acceptance/api/test_login.py::test_acc03_*, acceptance/e2e/login.spec.ts | PASS |
| ACC-04 | T2.1 | acceptance/api/test_boards.py::test_acc04_*, acceptance/e2e/boards.spec.ts (ACC-04) | PASS |
| ACC-05 | T1.4 | acceptance/e2e/session-watch.spec.ts (ACC-05 *) | PASS |
| BRD-01 | T2.1 | acceptance/api/test_boards.py::test_brd01_*, test_isolation_*, acceptance/e2e/boards.spec.ts (BRD-01) | PASS |
| BRD-02 | T2.1 | acceptance/api/test_boards.py::test_brd02_*, acceptance/e2e/boards.spec.ts (BRD-02) | PASS |
| BRD-03 | T2.1 | acceptance/api/test_boards.py::test_brd03_*, acceptance/e2e/boards.spec.ts (BRD-03) | PASS |
| BRD-04 | T2.1 | acceptance/api/test_boards.py::test_brd04_*, acceptance/e2e/boards.spec.ts (BRD-04) | PASS |
| BRD-05 | T2.1 | acceptance/api/test_boards.py::test_brd05_*, acceptance/e2e/boards.spec.ts (BRD-05) | PASS |
| BRD-06 | T2.1, T2.2 | acceptance/api/test_boards.py::test_brd06_*, test_folders.py::test_brd06_*, acceptance/e2e/boards.spec.ts (BRD-06), folders.spec.ts (BRD-06) | PASS |
| BRD-07 | T2.2 | acceptance/api/test_folders.py::test_brd07_*, acceptance/e2e/folders.spec.ts (BRD-07) | PASS |
| BRD-08 | T7.4 | — | не проверено |
| BRD-09 | T2.2 | acceptance/api/test_folders.py::test_brd09_*, acceptance/e2e/folders.spec.ts (BRD-09) | PASS |
| BRD-10 | T2.2 | acceptance/api/test_folders.py::test_brd10_*, acceptance/e2e/folders.spec.ts (BRD-10, desktop мышь + mobile касание) | PASS (BUG-001 исправлен в T4.2, acceptance/e2e/folders.spec.ts «BUG-001») |
| BRD-11 | T2.2 | acceptance/e2e/folders.spec.ts (BRD-11) | PASS |
| BRD-12 | T9.1 | — | не проверено |
| BRD-13 | T9.1 | — | не проверено |
| BRD-14 | T9.1 | — | не проверено |
| BRD-15 | T9.1 | — | не проверено |
| SHR-01 | T3.1 | acceptance/api/test_sharing.py::test_shr01_*, acceptance/e2e/share.spec.ts (SHR-01) | PASS |
| SHR-02 | T3.1 | acceptance/api/test_sharing.py::test_shr02_*, acceptance/e2e/share.spec.ts (SHR-02) | PASS |
| SHR-03 | T3.1 | acceptance/api/test_sharing.py::test_shr03_*, acceptance/e2e/share.spec.ts (SHR-03) | PASS |
| SHR-04 | T4.1 (канал), T11.2 | acceptance/api/test_realtime.py::test_shr04_*, test_col01_shr04_*; acceptance/e2e/realtime.spec.ts (SHR-04) | PASS (канал, T4.1); действия холста — T11.2 |
| SHR-05 | T3.1 | acceptance/api/test_sharing.py::test_shr05_*, acceptance/e2e/share.spec.ts (SHR-05) | PASS |
| SHR-06 | T3.1, T4.1 (WebSocket) | acceptance/api/test_sharing.py::test_shr06_*, acceptance/api/test_realtime.py::test_shr06_*, acceptance/e2e/share.spec.ts, realtime.spec.ts (SHR-06) | PASS |
| SHR-07 | T5.5 | — | не проверено |
| CVS-01 | T5.1 | acceptance/e2e/camera.spec.ts (CVS-01, desktop + mobile; объекты на холсте — перепроверить в T5.2) | PASS |
| CVS-02 | T5.1 | acceptance/e2e/camera.spec.ts (CVS-02, desktop + mobile) | PASS |
| CVS-03 | T5.1 | acceptance/e2e/camera.spec.ts (CVS-03, desktop) | PASS |
| CVS-04 | T5.1 | acceptance/e2e/camera.spec.ts (CVS-04, desktop + mobile); BUG-003 (minor) | PASS |
| CVS-05 | T5.1 | acceptance/e2e/camera.spec.ts (CVS-05, desktop + mobile) | PASS |
| CVS-06 | T5.2 | — | не проверено |
| CVS-07 | T5.4 | — | не проверено |
| CVS-08 | T5.5 | — | не проверено |
| CVS-09 | T5.2 | — | не проверено |
| CVS-10 | T5.2 | — | не проверено |
| CVS-11 | T5.2 | — | не проверено |
| CVS-12 | T5.2 | — | не проверено |
| CVS-13 | T5.2 | — | не проверено |
| CVS-14 | T5.2 | — | не проверено |
| CVS-15 | T5.3 | — | не проверено |
| CVS-16 | T5.3 | — | не проверено |
| CVS-17 | T5.3 | — | не проверено |
| CVS-18 | T5.3 | — | не проверено |
| CVS-19 | T5.3 | — | не проверено |
| CVS-20 | T5.3 | — | не проверено |
| CVS-21 | T5.2 | — | не проверено |
| CVS-22 | T5.3 | — | не проверено |
| CVS-23 | T5.2 | — | не проверено |
| CVS-24 | T5.4 | — | не проверено |
| CVS-25 | T5.4 | — | не проверено |
| CVS-26 | T6.4 | — | не проверено |
| MOB-01 | T11.1 | — | не проверено |
| MOB-02 | T5.1 | acceptance/e2e/camera.spec.ts (MOB-02, COL-04 MOB-02; mobile) | PASS |
| MOB-03 | T5.2 | — | не проверено |
| MOB-04 | T6.5 | — | не проверено |
| MOB-05 | T6.5 | — | не проверено |
| MOB-06 | T11.1 | — | не проверено |
| TXT-01 | T6.1 | — | не проверено |
| TXT-02 | T6.1 | — | не проверено |
| TXT-03 | T6.1 | — | не проверено |
| TXT-04 | T6.1 | — | не проверено |
| TXT-05 | T6.1 | — | не проверено |
| TXT-06 | T6.1 | — | не проверено |
| TXT-07 | T6.1 | — | не проверено |
| TXT-08 | T6.1 | — | не проверено |
| STK-01 | T6.2 | — | не проверено |
| STK-02 | T6.2 | — | не проверено |
| STK-03 | T6.2 | — | не проверено |
| STK-04 | T6.2 | — | не проверено |
| STK-05 | T6.2 | — | не проверено |
| SHP-01 | T6.3 | — | не проверено |
| SHP-02 | T6.3 | — | не проверено |
| SHP-03 | T6.3 | — | не проверено |
| SHP-04 | T6.3 | — | не проверено |
| CON-01 | T6.4 | — | не проверено |
| CON-02 | T6.4 | — | не проверено |
| CON-03 | T6.4 | — | не проверено |
| CON-04 | T6.4 | — | не проверено |
| CON-05 | T6.4 | — | не проверено |
| CON-06 | T6.4 | — | не проверено |
| CON-07 | T6.4 | — | не проверено |
| DRW-01 | T6.5 | — | не проверено |
| DRW-02 | T6.5 | — | не проверено |
| DRW-03 | T6.5 | — | не проверено |
| DRW-04 | T6.5 | — | не проверено |
| DRW-05 | T6.5 | — | не проверено |
| DRW-06 | T6.5 | — | не проверено |
| FRM-01 | T6.6 | — | не проверено |
| FRM-02 | T6.6 | — | не проверено |
| FRM-03 | T6.6 | — | не проверено |
| FRM-04 | T6.6 | — | не проверено |
| FRM-05 | T6.6 | — | не проверено |
| FRM-06 | T10.2 | — | не проверено |
| TBL-01 | T6.7 | — | не проверено |
| TBL-02 | T6.7 | — | не проверено |
| TBL-03 | T6.7 | — | не проверено |
| TBL-04 | T6.7 | — | не проверено |
| TBL-05 | T6.7 | — | не проверено |
| TBL-06 | T6.7 | — | не проверено |
| TBL-07 | T6.7 | — | не проверено |
| KBN-01 | T6.8 | — | не проверено |
| KBN-02 | T6.8 | — | не проверено |
| KBN-03 | T6.8 | — | не проверено |
| KBN-04 | T10.1 | — | не проверено |
| MAP-01 | T6.9 | — | не проверено |
| MAP-02 | T6.9 | — | не проверено |
| MAP-03 | T6.9 | — | не проверено |
| MAP-04 | T6.9 | — | не проверено |
| CMT-01 | T6.10 | — | не проверено |
| CMT-02 | T6.10 | — | не проверено |
| CMT-03 | T6.10 | — | не проверено |
| CMT-04 | T6.10 | — | не проверено |
| RCT-01 | T6.11 | — | не проверено |
| RCT-02 | T6.11 | — | не проверено |
| RCT-03 | T6.11 | — | не проверено |
| RCT-04 | T6.11 | — | не проверено |
| FLP-01 | T6.11 | — | не проверено |
| FLP-02 | T6.11 | — | не проверено |
| FLP-03 | T6.11 | — | не проверено |
| DICE-01 | T6.11 | — | не проверено |
| DICE-02 | T6.11 | — | не проверено |
| DICE-03 | T6.11 | — | не проверено |
| IMG-01 | T7.1 | — | не проверено |
| IMG-02 | T7.1 | — | не проверено |
| IMG-03 | T7.1 | — | не проверено |
| IMG-04 | T7.1 | — | не проверено |
| IMG-05 | T7.1 | — | не проверено |
| IMG-06 | T7.1 | — | не проверено |
| IMG-07 | T7.1 | — | не проверено |
| FIL-01 | T7.2 | — | не проверено |
| FIL-02 | T7.2 | — | не проверено |
| FIL-03 | T7.2 | — | не проверено |
| FIL-04 | T7.2 | — | не проверено |
| FIL-05 | T7.2 | — | не проверено |
| EMB-01 | T7.3 | — | не проверено |
| EMB-02 | T7.3 | — | не проверено |
| EMB-03 | T7.3 | — | не проверено |
| EMB-04 | T7.3 | — | не проверено |
| NTE-01 | T6.12 | — | не проверено |
| NTE-02 | T6.12 | — | не проверено |
| NTE-03 | T6.12 | — | не проверено |
| COL-01 | T4.1 | acceptance/api/test_realtime.py::test_col01_*, acceptance/e2e/realtime.spec.ts (COL-01) | PASS |
| COL-02 | T4.2 | acceptance/api/test_presence.py::test_col02_*, acceptance/e2e/presence.spec.ts (COL-02, desktop + mobile) | PASS |
| COL-03 | T4.2 | acceptance/e2e/presence.spec.ts (COL-03, desktop + mobile) | PASS |
| COL-04 | T4.2 | acceptance/api/test_presence.py::test_col04_*, acceptance/e2e/presence.spec.ts (COL-04, desktop + mobile), acceptance/e2e/camera.spec.ts «COL-04 MOB-02 …» (жесты телефона, T5.1) | PASS |
| COL-05 | T8.1 | — | не проверено |
| COL-06 | T8.1 | — | не проверено |
| COL-07 | T4.3 (основа), T8.2 | acceptance/api/test_history.py::test_col07_* (основа: снимки, сжатие журнала, поздний клиент, перезапуск `api`) | основа PASS (T4.3); требование — T8.2 |
| COL-08 | T4.3 (основа), T8.2 | acceptance/api/test_history.py::test_col08_* (основа: перенос в `trash`, `board_events` с именем из сессии) | основа PASS (T4.3); требование — T8.2 |
| COL-09 | T4.2 | acceptance/api/test_presence.py::test_col09_*, acceptance/e2e/presence.spec.ts (COL-09, desktop + mobile) | PASS |
| BAK-01 | T10.1 | — | не проверено |
| BAK-02 | T10.1 | — | не проверено |
| BAK-03 | T10.2 | — | не проверено |
| BAK-04 | T10.2 | — | не проверено |
| BAK-05 | T10.2 | — | не проверено |
| BAK-06 | T10.1, T11.2 (итог) | — | не проверено |

## Наблюдаемые решения архитектуры (без ID требования)

| Проверка | Задача | Приёмочный тест | Вердикт |
| --- | --- | --- | --- |
| ARCH-STACK-01…04 (сервисы, тома, `.env.example`) | T0.1 | ручная, docs/qa/reports/T0.1.md | PASS |
| ARCH-NET-01, 04, 05 (статика по LAN-IP, SPA-fallback, нет `localhost`) | T0.1 | acceptance/api/test_stack.py::test_arch_net* | PASS |
| ARCH-NET-02, 03 (`0.0.0.0`, `HTTP_PORT`) | T0.1 | ручная, docs/qa/reports/T0.1.md | PASS |
| ARCH-NET-06 (интерфейс грузится без ошибок) | T0.1, T2.2 | acceptance/e2e/stack.spec.ts (с T2.2 допускается `401` от `/api/*` при итоге на `/login`) | PASS (BUG-002 minor) |
| ARCH-PROXY-01…04 (`/api`, `/api/ws` через Caddy) | T0.1 | acceptance/api/test_stack.py::test_arch_proxy* | PASS |
| ARCH-FRAME-01…08 (фрейм только для `/b/{token}/embed`; часть EMB-04) | T0.1 | acceptance/api/test_stack.py::test_arch_frame*, acceptance/e2e/stack.spec.ts | PASS |
| ARCH-CFG-01…06 (обязательные переменные, пустые и неверные значения, секреты не в выводе) | T0.2 | acceptance/api/test_api_skeleton.py::test_arch_cfg* | PASS |
| ARCH-MIG-01…04 (Alembic на пустой базе до приёма трафика, повторный старт, база недоступна) | T0.2 | acceptance/api/test_api_skeleton.py::test_arch_mig* | PASS |
| ARCH-MIG-05, 06 (одна голова, только вперёд; таблицы по мере надобности) | T0.2 | ручная, docs/qa/reports/T0.2.md | PASS |
| ARCH-OAS-01…05 (`/api/openapi.json`, пути под `/api`, без `localhost`) | T0.2 | acceptance/api/test_api_skeleton.py::test_arch_oas* | PASS |
| ARCH-PROC-01…03 (Python 3.12, один процесс, регрессия прокси) | T0.2 | ручная + acceptance/api/test_stack.py | PASS |
| ARCH-DEVTOOL-01…04 (uv, ruff, mypy --strict, pytest, модули) | T0.2 | ручная, docs/qa/reports/T0.2.md | PASS |
| ARCH-WEB-01…09 (маршруты раздела 4 без ошибок, различимы, навигация, граничные и неизвестные пути, английский, фрейм для embed) | T0.3 | acceptance/e2e/web.spec.ts, acceptance/api/test_web_static.py::test_arch_web* | PASS |
| ARCH-WEBNET-01…04 (нет `localhost` в статике, запросы на адрес страницы, сокет из `location`, адрес не вписан при сборке) | T0.3 | acceptance/api/test_web_static.py::test_arch_webnet*, acceptance/e2e/web.spec.ts | PASS |
| ARCH-WEBDEV-01…06 (pnpm, tsc strict, ESLint, Prettier, Vitest, типы из OpenAPI, сборка) | T0.3 | ручная, docs/qa/reports/T0.3.md; test_web_static.py::test_arch_webdev06 | PASS |
| ARCH-ADM-01…08 (cookie `HttpOnly`/`SameSite=Lax`/без `Secure` на http, случайная сессия, лимит входа, запрет фрейма для `/admin/*`, API по адресу страницы, английский интерфейс, OpenAPI, нет горизонтальной прокрутки) | T1.1 | acceptance/api/test_admin.py::test_arch_adm*, acceptance/e2e/admin.spec.ts | PASS |
| ARCH-ACC-01…07 (cookie `myboard_session` `HttpOnly`/`SameSite=Lax`/без `Secure` на http, случайная сессия, запрет фрейма для `/login`, запросы на адрес страницы, английский интерфейс, OpenAPI входа, mobile без горизонтальной прокрутки) | T1.2 | acceptance/api/test_login.py::test_arch_acc*, acceptance/e2e/login.spec.ts | PASS |
| ARCH-T13-01…02 (флаги cookie и новый id сессии после смены пароля, контракт `PATCH` без 5xx в OpenAPI) | T1.3 | acceptance/api/test_session_revoke.py::test_arch_t13_* | PASS |
| ARCH-T21-01…03 (`/` и `/boards/{id}`, запросы только на адрес страницы, без горизонтальной прокрутки; запрет фрейма — регрессия; эндпоинты досок в OpenAPI) | T2.1 | acceptance/e2e/boards.spec.ts (ARCH-T21-01), acceptance/e2e/web.spec.ts, acceptance/api/test_boards.py::test_arch_t21_* | PASS |
| ARCH-T22-01…03 (`/` с папками и избранным — запросы только на адрес страницы, без горизонтальной прокрутки; эндпоинты папок и избранного в OpenAPI; запрет фрейма — регрессия) | T2.2 | acceptance/e2e/folders.spec.ts (ARCH-T22-01), acceptance/api/test_folders.py::test_arch_t22_*, acceptance/e2e/stack.spec.ts | PASS |
| ARCH-T31-01…04 (cookie участника `HttpOnly`/`SameSite=Lax`/без `Secure` на http, фрейм только для `/b/{token}/embed`, эндпоинты ссылки в OpenAPI, страницы ссылки — запросы только на адрес страницы, без горизонтальной прокрутки) | T3.1 | acceptance/api/test_sharing.py::test_arch_t31_*, acceptance/e2e/share.spec.ts (ARCH-T31-04) | PASS |
| ARCH-T41-01…03 (канал `/api/ws` только для сессии владельца или cookie участника этой доски, неразличимый отказ, закрытие при выходе; адрес канала из адреса страницы без `localhost`; кадры `sync` STEP1/STEP2/UPDATE) | T4.1 | acceptance/api/test_realtime.py::test_arch_t41_*, acceptance/e2e/realtime.spec.ts (ARCH-T41-02) | PASS |
| ARCH-T42-01 (кадры `awareness`/`presence` на `/api/ws`; повреждённый `awareness` и клиентский `presence` закрывают только отправителя `1007`) | T4.2 | acceptance/api/test_presence.py::test_arch_t42_01_* | PASS |
| ARCH-T42-02 (присутствие не в документе: нет `sync UPDATE`, поздний клиент — пустой документ, `updated_at` не меняется; нет в снимках и журнале; ZIP — T10.1) | T4.2, T4.3 | acceptance/api/test_presence.py::test_arch_t42_02_*, acceptance/api/test_history.py::test_arch_t42_02_* | PASS (ZIP — T10.1) |
| ARCH-T43-ENV (`SNAPSHOT_INTERVAL_SECONDS` необязательна) | T4.3 | acceptance/api/test_history.py::test_arch_t43_env_* | PASS |
