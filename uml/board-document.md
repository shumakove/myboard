# Документ доски Yjs

Содержимое доски — документ Yjs: в клиенте `yjs` (`apps/web/src/realtime/boardDocument.ts`), на сервере `pycrdt` (`app.realtime.room.BoardRoom._doc`). Сервер документ не интерпретирует: применяет обновления к своей копии и пересылает их; корни документа создаёт клиент. Метаданные списка (название, папка, ссылка, избранное) хранятся в PostgreSQL и в документ не входят; присутствие и курсоры — тоже.

```mermaid
classDiagram
  direction LR
  class BoardDocument {
    <<interface>>
    createBoardDocument(doc) BoardDocument$
    moveToTrash(board, ids, deletedBy, now) string[]$
    doc: Y.Doc
    objects: Y.Map~unknown~
    trash: Y.Map~unknown~
    comments: Y.Map~unknown~
    timer: Y.Map~unknown~
    votes: Y.Map~unknown~
    notes: Y.XmlFragment
  }
  class objects {
    <<Y.Map>>
    doc.getMap(objects)
    id → объект сцены
  }
  class trash {
    <<Y.Map>>
    doc.getMap(trash)
    id → TrashEntry
  }
  class TrashEntry {
    <<Y.Map, interface>>
    object: unknown
    deletedAt: string
    deletedBy: string
  }
  class comments {
    <<Y.Map>>
    doc.getMap(comments)
    id → ветка комментария
  }
  class timer {
    <<Y.Map>>
    doc.getMap(timer)
    общее состояние таймера
  }
  class votes {
    <<Y.Map>>
    doc.getMap(votes)
    id сессии голосования → голоса
  }
  class notes {
    <<Y.XmlFragment>>
    doc.getXmlFragment(notes)
    заметка доски
  }
  class BoardRoom {
    <<pycrdt, app.realtime.room>>
    board_id: UUID
    peers: set~Peer~
    _doc: pycrdt.Doc
    _seq: int
    _compacted_seq: int
    _trash: pycrdt.Map
    _trashed: list~str~
    BoardRoom(board_id, journal: Journal)
    state_vector() bytes
    missing_since(state_vector) bytes
    apply(update, sender, persist)
    compact(write) bool
    _on_trash_change(event: MapEvent)
  }
  class Journal {
    <<dataclass, app.realtime.store>>
    snapshot: Optional~bytes~
    updates: list~bytes~
    last_seq: int
  }
  BoardDocument *-- objects
  BoardDocument *-- trash
  BoardDocument *-- comments
  BoardDocument *-- timer
  BoardDocument *-- votes
  BoardDocument *-- notes
  trash *-- TrashEntry
  BoardRoom ..> Journal : загрузка
  BoardRoom ..> trash : observe (TRASH)
  BoardDocument .. BoardRoom : sync по /api/ws
```

- Объявлены только корни верхнего уровня. Значения пока не типизированы (`unknown`): типы объектов сцены (`type`, `z`, координаты относительно родителя) появятся в T5.*, комментарии — T6.10, таймер и голосование — T8.1, заметки — T6.12.
- Корзина (T4.3, основа COL-08): `moveToTrash(board, ids, deletedBy)` одной транзакцией Yjs для каждого известного id кладёт в `trash[id]` `Y.Map { object: копия объекта (вложенный общий тип — `clone()`), deletedAt: ISO 8601, deletedBy: имя }` и удаляет ключ из `objects`; неизвестные id пропускаются. Восстановления из корзины пока нет (T8.2). Жизненный цикл — [states/board-object.md](states/board-object.md).
- Сервер не разбирает объекты, но подписан на корень `trash` своей копии (`_on_trash_change`): ключи с действием `add`/`update` в принятом обновлении попадают в `JournalEntry.trashed`, и `store.append` пишет запись `board_events` `objects_deleted` с именем из сессии соединения ([data-model.md](data-model.md)). Подписка ставится после загрузки, поэтому состояние из снимка/журнала записей не порождает.
- Интерфейс пока не вызывает `moveToTrash` и не пишет в документ (кнопок удаления и объектов сцены нет — T5.*); документ создаётся заново на каждую открытую доску (`useBoardConnection`) и наполняется из `STEP2` сервера.
- Присутствие (курсоры, вид камеры, слежение, список участников — T4.2) в документ не входит: оно идёт сообщениями `awareness`/`presence` и живёт только в памяти соединений ([ws-protocol.md](ws-protocol.md)).
- Серверная копия собирается из последнего снимка `board_snapshots` и хвоста `board_updates` при первом подключении к доске (`Hub.join` → `store.load_journal` → `BoardRoom(board_id, journal)`) и выгружается, когда уходит последнее соединение (`Hub.leave`, с этим — сжатие журнала). Снимок — полное состояние `Doc.get_update()`; присутствия в нём нет. См. [data-model.md](data-model.md), [sequences/sync.md](sequences/sync.md).

Актуально на: T4.3, 7477309. Требования: COL-01, COL-07 и COL-08 (основа: снимки, корзина), COL-02…COL-04, COL-09 (вне документа); ARCHITECTURE.md, раздел 6 (структура документа, корзина).
