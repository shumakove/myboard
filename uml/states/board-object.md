# Объект доски

Жизненный цикл объекта сцены в документе Yjs ([board-document.md](../board-document.md)): ключ корня `objects` → ключ корня `trash`. Клиент — `moveToTrash` в `apps/web/src/realtime/boardDocument.ts`; сервер — подписка `BoardRoom._on_trash_change` (`app.realtime.room`) и запись ленты `app.history.events`.

```mermaid
stateDiagram-v2
  [*] --> InObjects: objects.set(id, объект) клиентом<br/>(инструментов создания пока нет — T5.*)
  InObjects --> InObjects: правки объекта — обновления sync UPDATE
  InObjects --> InTrash: moveToTrash(board, [id], deletedBy)<br/>одна транзакция Yjs:<br/>trash.set(id, {object: копия, deletedAt, deletedBy}),<br/>objects.delete(id)
  InTrash --> InObjects: objects.set(id, …) тем же id<br/>(запись trash[id] остаётся)
  InTrash --> InTrash: повторный moveToTrash того же id<br/>trash[id] перезаписан (action update)
  InTrash --> [*]: восстановления и окончательного удаления пока нет (T8.2)
```

Что делает сервер, когда принятое обновление переносит объект в корзину:

```mermaid
stateDiagram-v2
  state seen <<choice>>
  [*] --> Applied: BoardRoom.apply: _trashed = [], _doc.apply_update(update)
  Applied --> seen: _on_trash_change — ключи trash<br/>с action add или update
  seen --> Logged: есть ключи → JournalEntry.trashed<br/>store.append: INSERT board_updates +<br/>board_events (objects_deleted, {object_ids}, actor_name = Peer.name)
  seen --> Journaled: ключей нет → только INSERT board_updates
  Logged --> [*]: COMMIT, затем рассылка UPDATE
  Journaled --> [*]: COMMIT, затем рассылка UPDATE
```

- Перенос атомарен: у других участников объект не исчезает из `objects`, не появившись в `trash` (одна транзакция Yjs → одно обновление `sync`).
- В `trash[id].object` лежит копия: вложенный общий тип Yjs (например, `Y.Text`) копируется `clone()`, обычный JSON — как есть. Неизвестные id `moveToTrash` пропускает и не возвращает.
- `deletedBy` в документе — имя, которое указал клиент; лента берёт имя из сессии соединения, а не из документа.
- Подписка на `trash` ставится после загрузки снимка и журнала: повторное открытие доски записей ленты не порождает.
- Интерфейс пока не вызывает `moveToTrash` (кнопок удаления нет — T5.2/T5.3); просмотр корзины и восстановление — T8.2.

Актуально на: T4.3, 7477309. Требования: COL-08 (основа: корзина и лента удалений); ARCHITECTURE.md, разделы 6, 7.
