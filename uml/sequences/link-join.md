# Вход по ссылке

Владелец получает ссылку в диалоге Share (T3.1), участник без учётной записи открывает её и вводит имя. Маршруты — `app.sharing.router`, логика — `app.sharing.service`, сессии — `app.identity.sessions`. Клиент — `ShareDialog`, `SharedBoardPage`, `sharingApi.ts`.

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
      R-->>A: 200 SharedBoard {title, participant: {name}}
      P-->>G: You joined as {name}. (имя не спрашивается повторно)
    else сессии нет
      R-->>A: 200 SharedBoard {title, participant: null}
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
        R-->>A: 200 SharedBoard {title, participant: {name}},<br/>Set-Cookie myboard_board_{board.id.hex} (HttpOnly, SameSite=Lax, Path=/, Secure при https://, без Max-Age)
        P-->>G: You joined as {name}. (SHR-02)
      end
    end
  end
```

- Учётная запись не создаётся: строка `users` не появляется, в `GET /api/admin/users` участника нет. Гостевая cookie не открывает `/api/boards*`, `/api/folders*` (`401`) и другие доски.
- Отказ по ссылке один для всех недействующих токенов и не говорит, существует ли доска.
- Холста на `/b/:token` пока нет (T4.1, T5.*): после входа страница показывает название доски и имя участника.

Актуально на: T3.1, d4a2685. Требования: SHR-01, SHR-02, SHR-03, SHR-05.
