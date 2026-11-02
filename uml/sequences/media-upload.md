# Загрузка и выдача файла

Файлы досок (T7.1, T7.2, модуль `media`): загрузка изображения из файла и из буфера (IMG-01, IMG-07), файла, PDF, видео и аудио (FIL-01…FIL-04), выдача только сессии этой доски, замена и удаление фона (IMG-04, IMG-05), имя файла, скачивание и страницы PDF (FIL-01, FIL-02), копирование файла при вставке на другую доску (CVS-20, BUG-028). Маршруты — `app.media.router`, право — `app.media.access`, клиент — `apps/web/src/media/mediaApi.ts`, `scene/useImages.tsx` и `scene/useFiles.tsx`. Файл лежит в `MEDIA_ROOT/{board_id}/{media_id}`, строка — в таблице `media` ([data-model.md](../data-model.md)), объект — в документе Yjs ([board-document.md](../board-document.md)).

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
            R-->>A: 413, тело дочитано _discard и не сохранено (BUG-029)
            A-->>U: alert The file is too large to upload.
          else тип и длина подходят
            R->>M: save(чанки request.stream())
            M->>D: запись в {media_id}.part
            alt прочитано больше max_bytes
              M->>D: удалить .part
              R-->>A: 413, остаток тела дочитан _discard, файла и строки нет (BUG-029)
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
- Без `Content-Length` лимит проверяется по мере чтения потока: сверх лимита на диск ничего не пишется.
- Отказ `413` приходит после чтения тела (BUG-029): соединение, закрытое раньше конца тела, браузер считает ошибкой сети и размера файла не узнаёт. `_discard` читает тело без записи, не больше `REFUSED_BODY_MAX_BYTES` = 4 ГиБ; объявленное тело длиннее не читается вовсе. При `404` и `415` тело не читается.
- Проверяется объявленный тип без параметров, содержимое не распознаётся (ARCHITECTURE.md, раздел 8).

## Загрузка файла, PDF, видео и аудио

```mermaid
sequenceDiagram
  autonumber
  actor U as Владелец или участник
  participant S as BoardScene, useFiles
  participant D as attachmentData
  participant P as pdfDocument, mediaProbe
  participant A as mediaApi
  participant R as media.router
  participant Y as attachments, документ Yjs

  U->>S: chooseTool(file) → pick(центр вида), выбор файлов в поле Upload file
  S-->>U: status Uploading file…
  loop каждый файл, сдвиг CASCADE = 24
    S->>D: classifyFile(file) → type, mime
    alt type = pdf (FIL-02)
      S->>P: readPdf(file) → pages, размер первой страницы
      alt не PDF или PDF с паролем
        P-->>S: ошибка
        S-->>U: alert This PDF could not be opened. Файл не загружается
      else прочитан
        S->>A: uploadMedia(boardId, file, name, mime)
        A->>R: POST /api/boards/{board_id}/media?name=
        R-->>A: 201 MediaOut
        S->>Y: createAttachment(pdf, …, pages, pdfFrame(page, room()))
      end
    else type = video (FIL-03)
      S->>P: probeVideo(file) → кадр, 0×0 без дорожки видео, null за 5 с
      S->>A: uploadMedia(boardId, file, name, mime)
      A->>R: POST /api/boards/{board_id}/media?name=
      R-->>A: 201 MediaOut
      alt кадра нет, webm только со звуком (FIL-04)
        S->>Y: createAttachment(audio, …, audioFrame(room()))
      else кадр есть или браузер не прочитал файл
        S->>Y: createAttachment(video, …, videoFrame(probe, room()))
      end
    else type = audio (FIL-04)
      S->>A: uploadMedia(boardId, file, name, mime)
      A->>R: POST /api/boards/{board_id}/media?name=
      R-->>A: 201 MediaOut
      S->>Y: createAttachment(audio, …, audioFrame(room()))
    else type = file, всё остальное (FIL-01)
      S->>A: uploadMedia(boardId, file, name, application/octet-stream, file)
      A->>R: POST /api/boards/{board_id}/media?name=&kind=file
      R-->>A: 201 MediaOut
      S->>Y: createAttachment(file, …, 260×72)
    end
  end
  Note over Y: центр — clear(at, size), объект не ложится под миникарту (BUG-031)
  S->>S: select(ids), reveal() — холст снова в окне (BUG-031)
  S-->>U: новые объекты выделены, строка alert показывает последнюю ошибку
```

- Права, лимит и ответы `404`, `413`, `415` — как при загрузке изображения выше. `kind=file` принимает только `application/octet-stream`, без него этот тип — `415`.
- Размер кадра и страница PDF читаются браузером до загрузки: нечитаемый PDF не занимает место на сервере.

## Выдача файла

```mermaid
sequenceDiagram
  autonumber
  participant B as Браузер, img, video, audio, pdf.js
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
    alt запрос с Range, перемотка (FIL-03, FIL-04)
      R-->>CD: 206, Accept-Ranges bytes, Content-Range, запрошенные байты
    else без Range
      R-->>CD: 200, Accept-Ranges bytes, файл целиком
    end
    Note over R,CD: Content-Type — mime, CSP sandbox и frame-ancestors, nosniff, private no-cache, inline, с ?download= — attachment (FIL-01)
    CD-->>B: X-Frame-Options DENY, своя CSP ответа остаётся
  end
```

- Сброс ссылки удаляет гостевые сессии доски ([link-reset.md](link-reset.md)), поэтому старая cookie сразу получает `404`, а владелец — файл.
- `Cache-Control: private, no-cache`: браузер переспрашивает сервер, прежде чем взять свою копию, и отозванное право действует сразу (SHR-06).
- `<img>` не исполняет скрипты SVG, а открытый напрямую файл идёт под `sandbox` (IMG-07).
- Ярлык хранится как `application/octet-stream`: браузер его не показывает, даже если внутри HTML (FIL-01). Имя из `?download=` проходит `clean_name`.

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

## Имя файла, скачивание и страницы PDF

```mermaid
sequenceDiagram
  autonumber
  actor U as Владелец или участник
  participant C as FileControls
  participant S as useFiles
  participant Y as attachments, документ Yjs
  participant R as media.router

  alt File name (FIL-01)
    U->>C: ввод в поле File name
    C->>S: rename(name)
    S->>Y: renameAttachment — name и touch, пустое имя не записывается
    Y-->>U: новое имя у всех участников, media.original_name прежнее
  else Download (FIL-01)
    U->>C: ссылка Download, адрес — downloadUrl(media, name)
    C->>R: GET /api/media/{media_id}?download=имя
    R-->>U: 200, Content-Disposition attachment, имя после clean_name
  else Extract pages (FIL-02)
    U->>C: Extract pages
    C->>S: extract() → PdfExtractDialog
    U->>S: флажки Page N, Extract
    S->>Y: extractPdfPages — объекты pdf с тем же media и своим page правее исходного
    Y-->>U: новые объекты выделены и видны всем, исходный PDF остаётся
  end
```

- Поля имени нет у заблокированного ярлыка; `Extract pages` есть только у незаблокированного PDF целиком, а не у извлечённой страницы. Новых файлов на сервере извлечение не создаёт.
- Показ: `PdfView` рисует страницу через `renderPdfPage` (pdf.js читает `GET /api/media/{id}`), `MediaPlayer` — `<video>` или `<audio>` с тем же адресом. Листание, запуск, перемотка, громкость и скорость остаются в этом браузере, другим участникам ничего не передаётся (FIL-02, FIL-05).

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
- Копируются файлы всех объектов с полем `media`: изображений и, с T7.2, ярлыков, PDF, видео и аудио. Тексты `Copying images…` и `Some images could not be copied…` общие для всех файлов.

Актуально на: T7.2, 254185c (файлы, `Range`, `download`, отказ `413` — BUG-029; изображения и копирование — T7.1, 5aec139). Требования: FIL-01…FIL-05, IMG-01, IMG-04, IMG-05, IMG-07, CVS-20, SHR-04, SHR-06; ARCHITECTURE.md, раздел 8.
