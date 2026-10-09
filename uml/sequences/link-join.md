# Вход по ссылке

Владелец получает ссылку в диалоге Share (T3.1), участник без учётной записи открывает её и вводит имя. Маршруты — `app.sharing.router`, логика — `app.sharing.service`, сессии — `app.identity.sessions`. Клиент — `ShareDialog`, `SharedBoardPage`, `sharingApi.ts`; ссылка на объект (T5.5) — `ObjectLinkDialog`, `objectLink.ts`, `BoardLive`, `BoardScene`.

## Ссылка владельца

```mermaid
sequenceDiagram
  autonumber
  actor O as Владелец
  participant B as BoardPage (/boards/:id)
  participant D as ShareDialog
  participant A as sharingApi
  participant R as sharing.router
  participant L as library.service
  participant S as sharing.service
  participant DB as PostgreSQL

  O->>B: Share
  B->>D: открыть (boardId)
  D->>A: getShareLink(boardId)
  A->>R: GET /api/boards/{board_id}/share
  Note over R: UserDep (require_user): без сессии пользователя → 401
  R->>L: get_board(db, user.id, board_id)
  alt чужая, удалённая или несуществующая доска
    R-->>A: 404 "Board not found"
    A-->>D: SharingApiError → Board not found.
  else своя доска
    R->>S: current_token(db, board)
    opt share_token IS NULL (первый запрос)
      S->>DB: UPDATE boards SET share_token = token_urlsafe(32)<br/>WHERE id = … AND share_token IS NULL
      S->>DB: refresh(board)
    end
    R-->>A: 200 ShareLink {token, url = PUBLIC_BASE_URL/b/{token}} (SHR-01)
    A-->>D: Board link = url
  end
  O->>D: Copy link
  D->>D: copyText(url, field): navigator.clipboard<br/>или execCommand("copy") по http://
  D-->>O: Link copied. или Copy failed. Select the link and copy it.
```

## Вход участника

```mermaid
sequenceDiagram
  autonumber
  actor G as Участник (без учётки)
  participant P as SharedBoardPage (/b/:token)
  participant A as sharingApi
  participant R as sharing.router
  participant S as sharing.service
  participant SS as identity.sessions
  participant DB as PostgreSQL

  G->>P: открыть {PUBLIC_BASE_URL}/b/{token}
  P->>A: openSharedBoard(token)
  A->>R: GET /api/share/{token} (cookie myboard_board_* если есть)
  R->>S: board_by_token(db, token)
  S->>DB: SELECT boards WHERE share_token = token AND deleted_at IS NULL
  alt токен недействителен (отозван, неизвестен, длиннее 64, доска удалена)
    R-->>A: 404 "Link is not available" (SHR-05)
    A-->>P: SharingApiError 404
    P-->>G: Board unavailable / This link is not available.
  else доска найдена
    R->>S: participant(db, board, cookie myboard_board_{board.id.hex})
    S->>SS: find_board_session(cookie, board.id)
    SS->>DB: SELECT sessions WHERE id = sha256(cookie)<br/>AND subject_type = guest AND board_id = …
    alt сессия этой доски есть
      R-->>A: 200 SharedBoard {id, title, participant: {name}}
      P-->>G: You joined as {name}. (имя не спрашивается повторно)
    else сессии нет
      R-->>A: 200 SharedBoard {id, title, participant: null}
      P-->>G: Enter your name to join the board. (SHR-03)
      G->>P: Your name, Join board
      P->>A: joinSharedBoard(token, name)
      A->>R: POST /api/share/{token}/join {name}
      Note over R: JoinRequest.name: Name — обрезка пробелов, 1…200 символов, иначе 422
      R->>S: board_by_token(db, token)
      alt ссылку сбросили, пока вводили имя
        R-->>A: 404 "Link is not available"
        P-->>G: Board unavailable / This link is not available.
      else
        R->>S: join(db, board, name, cookie)
        opt у браузера уже есть сессия этой доски
          S->>SS: delete_session(cookie)
        end
        S->>SS: create_session(db, GUEST, uuid4(), board_id, display_name = name)
        SS->>DB: INSERT sessions (id = sha256(token), subject_type = guest, board_id, display_name)
        R-->>A: 200 SharedBoard {id, title, participant: {name}},<br/>Set-Cookie myboard_board_{board.id.hex} (HttpOnly, SameSite=Lax, Path=/, Secure при https://, без Max-Age)
        P-->>G: You joined as {name}. (SHR-02)
      end
    end
  end
```

## Ссылка на объект и переход по ней

```mermaid
sequenceDiagram
  autonumber
  actor U as Владелец или участник
  participant SC as BoardScene
  participant OD as ObjectLinkDialog
  participant A as sharingApi
  actor G as Получатель ссылки
  participant P as SharedBoardPage (/b/:token)
  participant L as BoardLive
  participant C as BoardConnection

  U->>SC: один объект выделен → меню объекта (правый щелчок или More)
  SC-->>U: Copy link to object (если есть boardLink)
  U->>SC: Copy link to object
  SC->>OD: открыть (objectId, boardLink)
  alt владелец (BoardPage)
    OD->>A: boardLink = shareUrl: getShareLink(boardId)
    A-->>OD: ShareLink.url = PUBLIC_BASE_URL/b/{token}
  else участник (SharedBoardPage)
    OD->>OD: boardLink = sharedBoardUrl(token): адрес страницы + /b/{token}
  end
  OD-->>U: Object link = objectLink(url, id) → …/b/{token}?object={id}
  U->>OD: Copy link → copyText → Link copied.
  G->>P: открыть …/b/{token}?object={id}
  P->>P: objectId = linkedObjectId(useSearch())
  P->>A: openSharedBoard(token) (и при нужде joinSharedBoard — как выше)
  alt токен недействителен
    A-->>P: 404
    P-->>G: Board unavailable / This link is not available. (канал не открывается)
  else участник вошёл
    P->>L: BoardLive(objectId, boardLink)
    L->>C: /api/ws?token=… (sync STEP1/STEP2)
    C-->>L: status online (документ сверен)
    L->>SC: focusObject = objectId (только после первого online)
    alt объект есть в objects
      SC->>SC: goTo(id): selection = [id], onMove(focusOn(rect, viewport))
      SC-->>G: вид на объекте, объект выделен (SHR-07)
    else объекта нет
      SC-->>G: The linked object is not on this board. + Dismiss (вид не меняется)
    end
  end
```

- Учётная запись не создаётся: строка `users` не появляется, в `GET /api/admin/users` участника нет. Гостевая cookie не открывает `/api/boards*`, `/api/folders*` (`401`) и другие доски.
- Отказ по ссылке один для всех недействующих токенов и не говорит, существует ли доска.
- Ссылка на объект (SHR-07) — та же ссылка на доску с `?object={id}`: доступ даёт только токен, после сброса ссылки старая ссылка на объект получает тот же отказ. Переход выполняется один раз на id (`BoardScene`, `linkedRef`); вид запоминается как обычно (CVS-05). Сервер параметр `object` не читает.
- После входа страница показывает имя участника и открывает `BoardLive` по токену (канал — [sync.md](sync.md), присутствие — [presence.md](presence.md)). `SharedBoard.id` (uuid доски, T5.1) — ключ запомненного вида камеры участника в `localStorage` (CVS-05); доступа он не даёт: канал и файлы участник открывает только по токену и cookie доски.

Актуально на: T5.5, 044e3c2 (ссылка на объект; вход — T5.1, 34125f1). Требования: SHR-01, SHR-02, SHR-03, SHR-05, SHR-07; CVS-05 (поле `id`).
