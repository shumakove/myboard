# Загрузка и выдача файла

Файлы досок (T7.1, модуль `media`): загрузка изображения из файла и из буфера (IMG-01, IMG-07), выдача только сессии этой доски, замена и удаление фона (IMG-04, IMG-05), копирование файла при вставке на другую доску (CVS-20, BUG-028). Маршруты — `app.media.router`, право — `app.media.access`, клиент — `apps/web/src/media/mediaApi.ts` и `scene/useImages.tsx`. Файл лежит в `MEDIA_ROOT/{board_id}/{media_id}`, строка — в таблице `media` ([data-model.md](../data-model.md)), объект — в документе Yjs ([board-document.md](../board-document.md)).

## Загрузка изображения

```mermaid
sequenceDiagram
  autonumber
  actor U as Владелец или участник
  participant S as BoardScene, useImages
  participant F as imageSource
  participant A as mediaApi
  participant R as media.router
  participant C as media.access
  participant M as media.service
  participant D as MEDIA_ROOT
  participant DB as PostgreSQL
  participant Y as images, документ Yjs

  alt инструмент Image (клавиша G)
    U->>S: chooseTool(image) → pick(центр вида), выбор файлов
  else Ctrl/⌘+V с файлом image/*
    U->>S: onImages(files) → insert(files, pastePoint())
  end
  loop каждый файл, сдвиг CASCADE = 24
    S->>S: isImageType(file.type)
    alt тип не из IMAGE_TYPES
      S-->>U: alert This file type is not supported. Use PNG, JPEG, GIF, WebP or SVG.
    else тип подходит
      S->>F: naturalSize(file)
      alt браузер не может показать файл
        F-->>S: ошибка
        S-->>U: alert This file is not an image that can be shown.
      else размер получен, SVG без размера — 300×300
        S->>A: uploadMedia(boardId, file, name, mime)
        A->>R: POST /api/boards/{board_id}/media?name=, тело — файл, Content-Type — mime
        R->>C: can_use_board(db, board_id, cookies)
        alt нет сессии этой доски, доска удалена или не существует
          R-->>A: 404 Not found
          A-->>U: alert You no longer have access to this board.
        else сессия участника или владельца
          R->>M: declared_type(content-type)
          alt тип не из ALLOWED_TYPES
            R-->>A: 415
          else Content-Length больше MAX_UPLOAD_BYTES
            R-->>A: 413, тело не читается
            A-->>U: alert The file is too large to upload.
          else тип и длина подходят
            R->>M: save(чанки request.stream())
            M->>D: запись в {media_id}.part
            alt прочитано больше max_bytes
              M->>D: удалить .part
              R-->>A: 413, файла и строки нет
              A-->>U: alert The file is too large to upload.
            else файл записан
              M->>D: rename в {board_id}/{media_id}
              M->>DB: INSERT media, COMMIT
              R-->>A: 201 MediaOut {id, name, mime, size, url}
              A-->>S: UploadedImage {media, mime, natural}
              S->>Y: createImage — центр в точке, большая сторона не больше 480
              Y-->>S: id нового объекта, sync рассылает его участникам
              S-->>U: новое изображение выделено
            end
          end
        end
      end
    end
  end
```

- На время загрузки видна строка `Uploading image…` (`useFileTask`, `role="status"`). Ошибка одного файла не отменяет остальные: загруженные встают и выделяются, строка `alert` показывает последнюю ошибку.
- Без `Content-Length` лимит проверяется по мере чтения потока: файл не дочитывается.
- Проверяется объявленный тип без параметров, содержимое не распознаётся (ARCHITECTURE.md, раздел 8).

## Выдача файла

```mermaid
sequenceDiagram
  autonumber
  participant B as Браузер, img src
  participant CD as Caddy
  participant R as media.router
  participant M as media.service
  participant C as media.access
  participant DB as PostgreSQL
  participant D as MEDIA_ROOT

  B->>CD: GET /api/media/{media_id} с cookie
  CD->>R: reverse_proxy api:8000
  R->>M: get(db, media_id)
  M->>DB: SELECT media
  R->>C: can_use_board(db, media.board_id, cookies)
  C->>DB: boards.deleted_at, сессия cookie myboard_board_{board_id.hex}
  opt нет сессии участника
    C->>DB: сессия myboard_session, active_user, get_board владельца
  end
  alt файла нет, нет права, ссылка сброшена, доска удалена
    R-->>B: 404 Not found, одно и то же тело
  else право есть, но файла нет на диске
    R->>D: is_file
    R-->>B: 404 Not found
  else право есть
    R->>D: чтение файла
    R-->>CD: 200, Content-Type — mime, CSP sandbox и frame-ancestors, nosniff, private no-cache, inline
    CD-->>B: X-Frame-Options DENY, своя CSP ответа остаётся
  end
```

- Сброс ссылки удаляет гостевые сессии доски ([link-reset.md](link-reset.md)), поэтому старая cookie сразу получает `404`, а владелец — файл.
- `Cache-Control: private, no-cache`: браузер переспрашивает сервер, прежде чем взять свою копию, и отозванное право действует сразу (SHR-06).
- `<img>` не исполняет скрипты SVG, а открытый напрямую файл идёт под `sandbox` (IMG-07).

## Замена и удаление фона

```mermaid
sequenceDiagram
  autonumber
  actor U as Владелец или участник
  participant C as ImageControls
  participant S as useImages
  participant F as imageSource
  participant A as mediaApi
  participant Y as images, документ Yjs

  alt Replace image (IMG-04)
    U->>C: выбор файла в поле Replacement image
    C->>S: replace(file)
    S->>F: naturalSize(file)
    S->>A: uploadMedia(boardId, file, file.name, mime)
    A-->>S: MediaOut
    S->>Y: replaceImage(свежий объект, {media, mime, natural})
  else Remove background (IMG-05)
    U->>C: Remove background
    C->>S: removeBackground()
    S->>F: withoutBackground(/api/media/{id})
    F->>F: canvas до 2048 px, clearBackground, toBlob PNG
    F-->>S: {blob, size}
    S->>A: uploadMedia(boardId, blob, background-removed.png, image/png)
    A-->>S: MediaOut
    S->>Y: replaceImage(свежий объект, {media, mime, natural = size})
  end
  Note over Y: media, mime, высота и y — одной транзакцией, crop, mask, flipX, flipY и оформление прежние
  Y-->>U: новый файл у всех участников, прежний файл на сервере остаётся
```

Запись идёт по свежему `readScene`: пока файл загружался, объект могли изменить или удалить другие участники; удалённый объект не воскрешается.

## Копирование файла при вставке на другую доску

```mermaid
sequenceDiagram
  autonumber
  actor U as Владелец или участник
  participant K as useSceneCommands.paste
  participant CL as clipboard
  participant A as mediaApi
  participant R as media.router
  participant C as media.access
  participant M as media.service
  participant D as MEDIA_ROOT
  participant DB as PostgreSQL
  participant Y as документ Yjs

  U->>K: Ctrl/⌘+V, Paste, копия с Clip.board
  K->>CL: foreignMedia(clip, boardId)
  alt та же доска или в копии нет файлов
    K->>CL: pasteObjects(clip) — сразу и без запроса, файл общий
    CL->>Y: объекты с новыми id
  else файлы другой доски
    K-->>U: status Copying images…
    K->>A: copyMedia(boardId, ids)
    A->>R: POST /api/boards/{board_id}/media/copies {media}
    R->>C: can_use_board(целевая доска)
    alt нет сессии целевой доски
      R-->>A: 404 Not found
      A-->>U: alert You no longer have access to this board.
    else сессия есть
      loop каждый уникальный id
        R->>M: get(db, media_id)
        alt файла нет
          Note over R: нет в ответе
        else файл этой доски
          Note over R: copies[id] = id, без копирования
        else файл другой доски
          R->>C: can_copy_from(source.board_id) — результат запоминается на запрос
          alt нет права
            Note over R: нет в ответе, неотличимо от несуществующего
          else сессия той доски или её владелец, и для доски в корзине
            R->>M: copy_to_board(source, board_id)
            M->>D: новый файл {board_id}/{новый id}
            M->>DB: INSERT media, COMMIT
            Note over R: copies[id] = новый id, пропавший или слишком большой файл — нет в ответе
          end
        end
      end
      R-->>A: 200 MediaCopiesOut {copies}
      K->>CL: withMedia(clip, copies), pasteObjects
      CL->>Y: объекты с файлами этой доски
      opt часть файлов не скопирована
        K-->>U: alert Some images could not be copied to this board. На объекте Image unavailable
      end
    end
  end
```

- Сбой запроса не вставляет ничего: `alert` The images could not be copied to this board. Try again., вставку можно повторить.
- Копия живёт независимо от источника: участник целевой доски получает файл без сессии исходной, удаление исходной доски копию не затрагивает (SHR-04).
- Каждая вставка с другой доски создаёт новый файл, повторы между вставками не учитываются. Дублирование и вставка на той же доске файл не копируют.

Актуально на: T7.1, 5aec139. Требования: IMG-01, IMG-04, IMG-05, IMG-07, CVS-20, SHR-04, SHR-06; ARCHITECTURE.md, раздел 8.
