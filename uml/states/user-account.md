# Учётная запись пользователя досок

Строка таблицы `users`; меняет её только администратор через `/api/admin/users` (кнопки Create user, Edit, Disable, Enable на `/admin/users`).

```mermaid
stateDiagram-v2
  [*] --> Active: POST /api/admin/users {name, email, password} → 201<br/>create_user
  note left of Active: почта занята → 409 Email is already in use,<br/>учётка не создаётся (ADM-07)
  Active --> Active: PATCH /api/admin/users/{id} {name?, email?, password?} → 200 (ADM-04)
  Active --> Disabled: PATCH {disabled: true} → 200 (ADM-05)<br/>+ delete_subject_sessions(USER, id)
  Disabled --> Active: PATCH {disabled: false} → 200 (ADM-06)
  Disabled --> Disabled: PATCH {name?, email?, password?} → 200
```

- Удаления учётки нет. Отключение трогает только `users.disabled` и сессии пользователя.
- Смена почты на занятую другой учёткой → `409`, строка не меняется; своя почта в другом регистре допускается. Неизвестный `id` → `404`, лишние поля → `422`.
- Новый пароль хэшируется Argon2id и заменяет `password_hash`. Пустое поле New password в форме Edit пароль не передаёт.
- Отказ во входе отключённой учётке (ADM-05) и вход после включения (ADM-06) реализуются входом пользователя досок в T1.2; сохранность досок — после появления таблицы `boards` (T2.1).

Актуально на: T1.1, 97556a8. Требования: ADM-03, ADM-04, ADM-05, ADM-06, ADM-07.
