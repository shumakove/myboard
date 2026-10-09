# Объект доски

Жизненный цикл объекта сцены в документе Yjs ([board-document.md](../board-document.md)): ключ корня `objects` → ключ корня `trash`. Клиент — `createObject`, `patchObjects`, `writeFields`, `objectMap` в `apps/web/src/scene/sceneObjects.ts`, `groupObjects`/`ungroupObjects` (`scene/groups.ts`), `setLocked`/`unlockAll` (`scene/lock.ts`), `pasteObjects` (`scene/clipboard.ts`) и `moveToTrash` в `apps/web/src/realtime/boardDocument.ts` (вызывает `SceneCommands.remove` из `scene/useSceneCommands.ts`); сервер — подписка `BoardRoom._on_trash_change` (`app.realtime.room`) и запись ленты `app.history.events`.

```mermaid
stateDiagram-v2
  state InObjects {
    [*] --> Unlocked
    Unlocked --> Unlocked: patchObjects — рамка и оформление (CVS-11, CVS-12, CVS-14),<br/>выравнивание и распределение (CVS-15), правка Y.Text,<br/>writeFields z — порядок слоёв (CVS-18),<br/>groupObjects / ungroupObjects — parent, x, y, z (CVS-17),<br/>каждая правка — updatedBy, updatedAt (CVS-22)
    Unlocked --> Locked: setLocked(ids, true) — Lock (CVS-19)
    Locked --> Unlocked: setLocked(ids, false) — Unlock,<br/>unlockAll — Unlock all у всех объектов
    Locked --> Locked: выделение, копирование,<br/>правки, слои и удаление пропускаются
  }
  [*] --> InObjects: createObject(objects, type, at, text, actor)<br/>одна транзакция — objects.set(id, Y.Map {type, parent = null,<br/>x, y, width, height, rotation = 0, z = topZ, стиль, text = Y.Text,<br/>createdBy/At = updatedBy/At = actor, now})<br/>(инструмент, перетаскивание кнопки, вставка текста, меню холста — CVS-09),<br/>pasteObjects — копия с новым id, поверх, без locked (CVS-20),<br/>groupObjects — новая группа type = group (CVS-17)
  InObjects --> InTrash: moveToTrash(board, removalSet(ids), deletedBy = имя своего peer)<br/>Delete/Backspace, кнопка Delete, пункт меню (CVS-21), Cut (CVS-20)<br/>одна транзакция Yjs —<br/>trash.set(id, {object = копия, deletedAt, deletedBy}),<br/>objects.delete(id)
  InObjects --> [*]: ungroupObjects — группа удаляется из objects<br/>(без корзины), её объекты переходят к родителю
  InTrash --> InObjects: objects.set(id, …) тем же id<br/>(запись trash[id] остаётся)
  InTrash --> InObjects: Undo своего удаления — UndoHistory.undo (CVS-07)<br/>одна транзакция — objects[id] возвращён,<br/>trash[id] удалён или возвращено прежнее значение
  InObjects --> [*]: Undo своего создания, вставки или группировки —<br/>ключ удаляется из objects без корзины (CVS-07)
  InTrash --> InTrash: повторный moveToTrash того же id<br/>trash[id] перезаписан (action update)
  InTrash --> [*]: восстановления и окончательного удаления пока нет (T8.2)
```

Что делает сервер, когда принятое обновление переносит объект в корзину:

```mermaid
stateDiagram-v2
  state seen <<choice>>
  [*] --> Applied: BoardRoom.apply — _trashed = [], _doc.apply_update(update)
  Applied --> seen: _on_trash_change — ключи trash<br/>с action add или update
  seen --> Logged: есть ключи → JournalEntry.trashed<br/>store.append — INSERT board_updates +<br/>board_events (objects_deleted, {object_ids}, actor_name = Peer.name)
  seen --> Journaled: ключей нет → только INSERT board_updates
  Logged --> [*]: COMMIT, затем рассылка UPDATE
  Journaled --> [*]: COMMIT, затем рассылка UPDATE
```

- Перенос атомарен: у других участников объект не исчезает из `objects`, не появившись в `trash` (одна транзакция Yjs → одно обновление `sync`).
- В `trash[id].object` лежит копия: вложенный общий тип Yjs (например, `Y.Text`) копируется `clone()`, обычный JSON — как есть. Неизвестные id `moveToTrash` пропускает и не возвращает.
- `deletedBy` в документе — имя, которое указал клиент; лента берёт имя из сессии соединения, а не из документа.
- Подписка на `trash` ставится после загрузки снимка и журнала: повторное открытие доски записей ленты не порождает.
- Блокировка (T5.3, CVS-19) — поле `locked: true` самого объекта; объект внутри заблокированной группы считается заблокированным (`SceneObject.locked`) и разблокируется только вместе с группой. `removalSet` не удаляет заблокированные и группу, содержащую заблокированный объект; вместе с выбранным уносит вложенные объекты групп и группы, у которых не остаётся объектов.
- Вставка и дублирование (CVS-20) не переносят `locked`, автора и даты: копия — новый объект вставившего. Разгруппировка удаляет ключ группы из `objects` напрямую, в корзину и ленту это не попадает.
- Интерфейс (T5.2) создаёт объекты `createObject` (CVS-09), правит `patchObjects` и `Y.Text` и удаляет выделенное `moveToTrash` с именем своего участника из присутствия (CVS-21): клавиши Delete/Backspace вне полей ввода, кнопка `Delete` панели «Selection», пункт `Delete` / `Delete N objects` меню объекта. Удаление, сделанное другим участником, убирает объект из своего выделения. Просмотр корзины и восстановление — T8.2.

- Отмена и повтор (T5.4, CVS-07) — `Y.UndoManager` над `objects`, `trash`, `settings` только для своих транзакций: Undo возвращает объект в прежнее состояние любого перехода выше (правка, блокировка, слои, группы, создание, удаление), Redo повторяет. Отмена удаления на сервере не считается удалением (`_on_trash_change` реагирует только на `add`/`update`), поэтому запись `objects_deleted` в ленте остаётся. Правку поля, которое позже изменил другой участник, отмена не перезаписывает.

Актуально на: T5.4, e2d1150 (сервер — T4.3, 7477309). Требования: CVS-07 (отмена и повтор), CVS-09 (создание), CVS-11, CVS-12, CVS-14 (правки), CVS-15, CVS-17, CVS-18 (выравнивание, группы, слои), CVS-19 (блокировка), CVS-20 (вставка, вырезание), CVS-22 (автор и даты), CVS-21 (удаление в корзину), COL-08 (основа: корзина и лента удалений); ARCHITECTURE.md, разделы 6, 7.
