# Матрица трассируемости

ID требования из [REQUIREMENTS.md](../../REQUIREMENTS.md) → задача из [PLAN.md](../../PLAN.md) → приёмочный тест → вердикт. Ведёт QA; вердикт обновляется после каждой приёмки (WORKFLOW.md, 6.2).

Вердикты: `не проверено`, `PASS`, `FAIL (BUG-NNN)`, `BLOCKED (Q-NNN)`.

| Требование | Задача | Приёмочный тест | Вердикт |
| --- | --- | --- | --- |
| ADM-01 | T1.1 | acceptance/api/test_admin.py::test_adm01_*, acceptance/e2e/admin.spec.ts | PASS |
| ADM-02 | T1.1 | acceptance/api/test_admin.py::test_adm02_*, acceptance/e2e/admin.spec.ts | PASS |
| ADM-03 | T1.1 | acceptance/api/test_admin.py::test_adm03_*, acceptance/e2e/admin.spec.ts | PASS |
| ADM-04 | T1.1, T1.2, T1.3 | acceptance/api/test_admin.py::test_adm04_*, acceptance/api/test_login.py::test_adm04_*, acceptance/api/test_session_revoke.py::test_adm04_*, acceptance/e2e/admin.spec.ts, acceptance/e2e/login.spec.ts, acceptance/e2e/session-revoke.spec.ts | PASS (в т.ч. отзыв сессий при смене пароля, T1.3) |
| ADM-05 | T1.1, T1.2 | acceptance/api/test_admin.py::test_adm05_*, acceptance/api/test_login.py::test_adm05_*, acceptance/e2e/admin.spec.ts, acceptance/e2e/login.spec.ts | PASS (сохранность досок — регрессия T2.1) |
| ADM-06 | T1.1, T1.2 | acceptance/api/test_admin.py::test_adm06_*, acceptance/api/test_login.py::test_adm06_*, acceptance/e2e/admin.spec.ts, acceptance/e2e/login.spec.ts | PASS |
| ADM-07 | T1.1 | acceptance/api/test_admin.py::test_adm07_*, acceptance/e2e/admin.spec.ts | PASS |
| ACC-01 | T1.2 | acceptance/api/test_login.py::test_acc01_*, acceptance/e2e/login.spec.ts | PASS |
| ACC-02 | T1.2 | acceptance/api/test_login.py::test_acc02_*, acceptance/e2e/login.spec.ts | PASS |
| ACC-03 | T1.2 | acceptance/api/test_login.py::test_acc03_*, acceptance/e2e/login.spec.ts | PASS |
| ACC-04 | T2.1 | — | не проверено |
| ACC-05 | T1.4 | acceptance/e2e/session-watch.spec.ts (ACC-05 *) | PASS |
| BRD-01 | T2.1 | — | не проверено |
| BRD-02 | T2.1 | — | не проверено |
| BRD-03 | T2.1 | — | не проверено |
| BRD-04 | T2.1 | — | не проверено |
| BRD-05 | T2.1 | — | не проверено |
| BRD-06 | T2.1 | — | не проверено |
| BRD-07 | T2.2 | — | не проверено |
| BRD-08 | T7.4 | — | не проверено |
| BRD-09 | T2.2 | — | не проверено |
| BRD-10 | T2.2 | — | не проверено |
| BRD-11 | T2.2 | — | не проверено |
| BRD-12 | T9.1 | — | не проверено |
| BRD-13 | T9.1 | — | не проверено |
| BRD-14 | T9.1 | — | не проверено |
| BRD-15 | T9.1 | — | не проверено |
| SHR-01 | T3.1 | — | не проверено |
| SHR-02 | T3.1 | — | не проверено |
| SHR-03 | T3.1 | — | не проверено |
| SHR-04 | T4.1 (канал), T11.2 | — | не проверено |
| SHR-05 | T3.1 | — | не проверено |
| SHR-06 | T3.1 | — | не проверено |
| SHR-07 | T5.5 | — | не проверено |
| CVS-01 | T5.1 | — | не проверено |
| CVS-02 | T5.1 | — | не проверено |
| CVS-03 | T5.1 | — | не проверено |
| CVS-04 | T5.1 | — | не проверено |
| CVS-05 | T5.1 | — | не проверено |
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
| MOB-02 | T5.1 | — | не проверено |
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
| COL-01 | T4.1 | — | не проверено |
| COL-02 | T4.2 | — | не проверено |
| COL-03 | T4.2 | — | не проверено |
| COL-04 | T4.2 | — | не проверено |
| COL-05 | T8.1 | — | не проверено |
| COL-06 | T8.1 | — | не проверено |
| COL-07 | T4.3 (основа), T8.2 | — | не проверено |
| COL-08 | T4.3 (основа), T8.2 | — | не проверено |
| COL-09 | T4.2 | — | не проверено |
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
| ARCH-NET-06 (интерфейс грузится без ошибок) | T0.1 | acceptance/e2e/stack.spec.ts | PASS |
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
