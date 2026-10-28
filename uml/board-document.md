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
    settings: Y.Map~unknown~
  }
  class objects {
    <<Y.Map>>
    doc.getMap(objects)
    id → SceneObjectMap
  }
  class SceneObjectMap {
    <<Y.Map, объект сцены>>
    type: sticky | shape | text | document | stack | line | drawing | frame | table | kanban | card | mindmap | reaction | flipcard | dice | group
    parent: string | null
    cell?: string — ключ ячейки таблицы-родителя или id столбца канбана
    x: number
    y: number
    width: number
    height: number
    rotation: number
    z: number
    shape?: string
    marker?: string
    fill?: string | transparent
    stroke?: string
    strokeWidth?: number
    radius?: number
    lineStyle?: straight | elbow | curved
    startCap?: none | arrow | triangle | circle | diamond
    endCap?: none | arrow | triangle | circle | diamond
    start?: LineEnd
    end?: LineEnd
    points?: Point[] у line, number[] у drawing
    brush?: pen | marker
    baseWidth?: number
    baseHeight?: number
    labels?: Y.Map~LineLabelMap~
    color?: string
    fontSize?: number | auto
    fontFamily?: sans | serif | mono | hand
    fontStyle?: normal | bold | italic | bold-italic | underline | strike
    align?: left | center | right | justify
    lineHeight?: number
    background?: string
    appearance?: fill | border | outline — frame
    keepRatio?: boolean — frame
    contentHidden?: boolean — frame
    lockContent?: boolean — frame, нет поля = true
    columns?: Y.Array~string~ — table и kanban, id столбцов
    rows?: Y.Array~string~ — table, id строк
    sizes?: Y.Map~number~ — table, id линии → ширина или высота
    cells?: Y.Map~TableCellMap~ — table, ключ строка:столбец
    titles?: Y.Map~Y.Text~ — kanban, id столбца → название
    root?: string — mindmap, id корневого узла
    nodes?: Y.Map~MindmapNodeMap~ — mindmap, id узла → узел
    image?: string — reaction, эмодзи из REACTION_SETS
    backText?: Y.Text — flipcard, текст оборота
    flipped?: boolean — flipcard, показан оборот
    direction?: horizontal | vertical — flipcard
    frontFill … frontImage, backFill … backImage — flipcard, FlipSideFields
    faces?: 4 | 6 | 8 | 10 | 12 | 20 — dice
    value?: number | null — dice, null до броска
    roll?: number — dice, номер броска
    text?: Y.Text — нет у drawing, kanban, mindmap, reaction и dice
    tags?: Y.Array~string~
    showAuthor?: false
    locked?: true
    createdBy?: string
    createdAt?: string
    updatedBy?: string
    updatedAt?: string
  }
  class RichTextContent {
    <<Y.Text с атрибутами Quill, text, document и sticky>>
    символы: bold?, italic?, underline?, strike?: true
    символы: link?: string
    перевод строки: header?: 1 | 2 | 3
    перевод строки: list?: bullet | ordered | checked | unchecked
    перевод строки: indent?: 1…8
    вставка документа: divider: true
    вставка документа: objectLink: id объекта
  }
  class settings {
    <<Y.Map>>
    doc.getMap(settings)
    background: string
    gridStep: number
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
    id → CommentThreadMap
  }
  class CommentThreadMap {
    <<Y.Map, ветка комментария>>
    anchor: CommentAnchor — запись-JSON
    color: string — #rrggbb
    resolved: boolean
    createdAt: string — ISO 8601
    createdBy: string — имя автора
    messages: Y.Array~CommentMessage~
  }
  class CommentAnchor {
    <<type, comments/commentData.ts>>
    object: string | null
    u, v: number — доли рамки объекта без поворота
    x, y: number — точка доски при object null
  }
  class CommentMessage {
    <<interface, comments/commentData.ts>>
    id: string
    author: string — имя из сессии
    text: string
    at: string — ISO 8601
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
    пусто — заметку не начинали
    один NoteText — заметка доски
  }
  class NoteText {
    <<Y.XmlText, узел 0:0, notes/noteData.ts>>
    создатель — служебный клиент NOTE_CLIENT_ID = 0
    атрибут openForAll: boolean
    текст — атрибуты Quill как RichTextContent
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
    _journal: list~StoredUpdate~
    BoardRoom(board_id, journal: Journal)
    state_vector() bytes
    missing_since(state_vector) bytes
    apply(updates: Sequence~bytes~, sender, persist)
    _integrate(update, sender) JournalEntry
    compact(write) bool
    _on_trash_change(event: MapEvent)
  }
  class Journal {
    <<dataclass, app.realtime.store>>
    snapshot: Optional~bytes~
    updates: list~StoredUpdate~
    last_seq: int
  }
  class StoredUpdate {
    <<NamedTuple, app.realtime.store>>
    seq: int
    update: bytes
  }
  BoardDocument *-- objects
  BoardDocument *-- trash
  BoardDocument *-- comments
  BoardDocument *-- timer
  BoardDocument *-- votes
  BoardDocument *-- notes
  BoardDocument *-- settings
  objects *-- SceneObjectMap
  SceneObjectMap *-- RichTextContent : text (text, document, sticky)
  trash *-- TrashEntry
  comments *-- CommentThreadMap
  CommentThreadMap *-- CommentAnchor : anchor
  CommentThreadMap *-- CommentMessage : messages
  BoardRoom ..> Journal : загрузка
  Journal *-- StoredUpdate
  BoardRoom ..> StoredUpdate : _journal — строки до сжатия
  BoardRoom ..> trash : observe (TRASH)
  BoardDocument .. BoardRoom : sync по /api/ws
  class sceneBounds {
    <<apps/web canvas/sceneBounds.ts>>
    sceneRects(objects) Rect[]$
    useSceneRects(objects) Rect[]$
  }
  class Rect {
    <<interface, canvas/camera.ts>>
    x: number
    y: number
    width: number
    height: number
  }
  sceneBounds ..> objects : observeDeep, чтение x, y, width, height, parent
  sceneBounds ..> Rect : для Minimap
  class sceneObjects {
    <<apps/web scene/sceneObjects.ts>>
    readScene(objects) SceneObject[]$
    createObject(objects, type, at, text: string | DeltaOp[], actor, style, size) string$
    objectMap(objects, id) Y.Map | null$
    objectText(objects, id) Y.Text | null$
    patchObjects(objects, patches, actor) void$
    writeFields(objects, changes, actor) void$
    transact(objects, write) void$
    topZ(objects) number$
    creationMeta(actor, now) ObjectMeta$
    touch(map, actor, now) void$
    newObjectId() string$
    writeTags(map, tags) void$
  }
  class SceneObject {
    <<interface, scene/sceneObjects.ts>>
    id: string
    type: string
    parent: string | null
    x, y, width, height: number
    rotation: number
    z: number
    text: string
    rich: DeltaOp[] | null
    tags: string[]
    showAuthor: boolean
    style: StyleKey → string | number
    origin: Point
    offset: Point
    locked: boolean
    meta: ObjectMeta
    line: LineShape | null
    drawing: DrawingShape | null
    frameOptions: FrameOptions | null
    hidden: boolean
    table: TableShape | null
    kanban: KanbanShape | null
    mindmap: MindmapShape | null
    reaction: ReactionShape | null
    flip: FlipShape | null
    dice: DiceShape | null
    cell: string | null
  }
  class ObjectMeta {
    <<interface, scene/sceneObjects.ts>>
    createdBy?: string
    createdAt?: string
    updatedBy?: string
    updatedAt?: string
  }
  class groups {
    <<apps/web scene/groups.ts>>
    ancestors(scene, id) SceneObject[]$
    withDescendants(scene, ids) SceneObject[]$
    topmost(scene, ids) SceneObject[]$
    selectionTarget(scene, leafId, selection) string$
    enterGroup(scene, leafId, selection) string | null$
    canGroup(units) boolean$
    groupObjects(objects, scene, units, actor) string | null$
    ungroupObjects(objects, scene, groups, actor) string[]$
    removalSet(scene, ids) string[]$
  }
  class layers {
    <<apps/web scene/layers.ts>>
    LayerOp: front | forward | backward | back
    reorder(siblings, selected, op) T[]$
    renumber(order) Map$
  }
  class lock {
    <<apps/web scene/lock.ts>>
    setLocked(objects, ids, locked, actor) void$
    unlockAll(objects, actor) void$
    lockedIds(objects) string[]$
  }
  class clipboard {
    <<apps/web scene/clipboard.ts>>
    CLIPBOARD_MIME = application/x-myboard-objects$
    DUPLICATE_OFFSET = 20$
    copyObjects(objects, scene, ids) Clip | null$
    pasteObjects(objects, clip, place, actor) string[]$
    parseClip(text) Clip | null$
    clipText(clip, label) string$
    clipHtml(clip, label) string$
    loadClip() Clip | null$
    saveClip(clip) void$
  }
  class Clip {
    <<interface, localStorage myboard.clipboard>>
    format: myboard/objects
    objects: ClipObject[]
    bounds: Rect
  }
  class ClipObject {
    <<interface>>
    id: string
    parent: string | null
    fields: поля объекта без parent, locked, автора и дат
    fields.text: string | DeltaOp[]
  }
  class ObjectTypeSpec {
    <<interface, scene/objectTypes.ts>>
    RICH_TEXT_TYPES = text, document, sticky$
    TAGGED_TYPES = sticky, stack$
    AUTO_FONT_SIZE = auto$
    STICKY_COLORS$
    FONT_SIZES$
    NO_COLOR = transparent, None$
    isRichText(type) boolean$
    type: ObjectType
    label: string
    plural: string
    width: number
    height: number
    rotatable: boolean
    editable: boolean
    style: StyleKey → string | number
  }
  class stickies {
    <<apps/web scene/stickies.ts>>
    NEXT_STICKY_GAP = 20$
    STICKY_COLOR_KEY = myboard.stickyColor$
    stickyColor(value) string — палитра или #rrggbb$
    loadStickyColor() string$
    rememberStickyColor(color) void$
    createNextSticky(objects, sticky, actor) string$
    pullSticky(objects, stack, at, actor) string$
  }
  class tags {
    <<apps/web scene/tags.ts>>
    normalizeTag(raw) string | null$
    addTag(objects, id, raw, actor) boolean$
    removeTag(objects, id, tag, actor) void$
  }
  class boardSettings {
    <<apps/web scene/boardSettings.ts>>
    DEFAULT_SETTINGS: BoardSettings$
    BACKGROUNDS$
    GRID_STEPS: 0, 10, 20, 40, 80$
    readSettings(settings) BoardSettings$
    updateSettings(settings, patch) void$
    useBoardSettings(settings) BoardSettings$
  }
  class search {
    <<apps/web scene/search.ts>>
    searchScene(scene, query) SearchHit[]$
  }
  class SearchHit {
    <<interface, scene/search.ts>>
    object: SceneObject
    snippet: string
    tags: string[]
  }
  class textBinding {
    <<apps/web scene/textBinding.ts>>
    applyTextChange(text, before, after) void$
    shiftIndex(index, delta) number$
  }
  class richDelta {
    <<apps/web richtext/delta.ts>>
    toBlocks(ops) Block[]$
    plainText(ops, label) string$
    isRich(ops) boolean$
    parseDelta(value) DeltaOp[] | null$
    normalizeDelta(ops) DeltaOp[]$
    safeLink(value) string | null$
    MAX_INDENT = 8$
  }
  class DeltaOp {
    <<interface, richtext/delta.ts>>
    insert?: string | divider | objectLink
    delete?: number
    retain?: number
    attributes?: Attributes
  }
  class richBinding {
    <<apps/web richtext/binding.ts>>
    bindQuill(quill, text: Y.Text, onEdit) unbind$
    minimalChange(change, before) DeltaOp[]$
  }
  class richHtml {
    <<apps/web richtext/html.ts>>
    deltaToHtml(ops, label) string$
    htmlToDelta(html, kind) DeltaOp[]$
  }
  class textStyle {
    <<apps/web scene/textStyle.ts, sessionStorage>>
    TEXT_STYLE_KEY = myboard.textStyle$
    loadTextStyle() fontSize?, color?$
    rememberTextStyle(key, value) void$
  }
  class LineEnd {
    <<JSON, scene/connectors.ts>>
    x: number
    y: number
    object?: string
    anchor?: n | e | s | w
  }
  class LineLabelMap {
    <<Y.Map, подпись линии>>
    text: Y.Text
    position: number 0…1
    orientation: horizontal | along
    align: left | center | right
    fontFamily: sans | serif | mono | hand
    fontSize: number
    color: string
  }
  class LineShape {
    <<interface, scene/connectors.ts>>
    start, end: LineEnd
    points: Point[]
    labels: LineLabel[]
    path: Point[] — точки на доске
    startDir, endDir: Point | null
    segments: Point[][]
  }
  class connectors {
    <<apps/web scene/connectors.ts>>
    ANCHORS = n, e, s, w$
    LABEL_DEFAULTS$
    LABEL_PLACES = start 0.1, center 0.5, end 0.9$
    readEnd(value, fallback) LineEnd$
    readLineData(record) LineData$
    anchorPoint(frame, anchor) Point$
    anchorDirection(frame, anchor) Point$
    isConnectable(type) boolean — не line и не group$
    resolveLine(data, position, frames, style) LineShape$
    findAttachment(objects, p, threshold, exclude)$
    constrainAngle(base, p, free) Point$
    routeSegments(style, path, startDir, endDir) Point[][]$
    pointAlong(route, t), projectOnto(route, p)$
  }
  class lineEdits {
    <<apps/web scene/lineEdits.ts>>
    createLine(objects, start, end, actor, style) string$
    setEnd(objects, line, name, end, actor)$
    setPoints(objects, line, points, actor)$
    removePoint(objects, line, index, actor)$
    swapEnds(objects, line, actor)$
    detachLine(objects, line, actor)$
    detachFrom(objects, scene, removed, actor)$
    addLabel(objects, lineId, position, actor) string$
    labelText(objects, lineId, labelId) Y.Text | null$
    setLabel(objects, lineId, labelId, fields, actor)$
    removeLabel(objects, lineId, labelId, actor)$
    labelValue(value), labelsValue(value) Y.Map$
  }
  SceneObjectMap *-- LineEnd : start, end (line)
  SceneObjectMap *-- LineLabelMap : labels (line)
  LineEnd ..> SceneObjectMap : object — id объекта привязки (CVS-26)
  SceneObject --> LineShape : line (у остальных типов null)
  sceneObjects ..> connectors : readLineData, resolveLine — привязанные концы по рамкам объектов
  connectors ..> LineShape
  lineEdits ..> SceneObjectMap : start, end, points, labels + touch — одной транзакцией
  lineEdits ..> LineLabelMap : Y.Map с текстом Y.Text
  lineEdits ..> sceneObjects : createObject, objectMap, transact, touch, newObjectId
  clipboard ..> lineEdits : labelsValue — подписи копии
  clipboard ..> connectors : readEnd — привязка только к скопированным
  sceneObjects ..> objects : observeDeep (useSceneObjects), запись одной транзакцией
  sceneObjects ..> SceneObject : readScene — координаты доски, по z
  sceneObjects ..> ObjectTypeSpec : OBJECT_TYPES — размер и стиль нового
  boardSettings ..> settings : observe, set
  textBinding ..> SceneObjectMap : text — минимальная замена (shape)
  richBinding ..> RichTextContent : applyDelta своей правки, observe чужих
  sceneObjects ..> richDelta : rich = Y.Text.toDelta()
  richDelta ..> DeltaOp
  SceneObject --> DeltaOp : rich
  clipboard ..> richDelta : isRich, parseDelta, plainText
  clipboard ..> richHtml : clipHtml — text/html
  textStyle ..> sceneObjects : style нового text (TXT-05)
  SceneObject *-- ObjectMeta
  sceneObjects ..> ObjectMeta : creationMeta, touch — createdBy/At, updatedBy/At
  groups ..> objects : group, parent, x, y, z — одной транзакцией
  groups ..> layers : renumber при разгруппировке
  layers ..> SceneObjectMap : z среди соседей одного parent
  lock ..> SceneObjectMap : locked через writeFields
  clipboard ..> Clip
  Clip *-- ClipObject
  clipboard ..> objects : чтение копии, вставка новыми id
  search ..> SceneObject : text, tags — без записи в документ
  search ..> SearchHit
  SearchHit --> SceneObject
  stickies ..> objects : createObject + width, height, fill, fontSize, showAuthor, tags — одной транзакцией
  stickies ..> sceneObjects : createObject, objectMap, transact, writeTags
  tags ..> SceneObjectMap : tags — push / delete в Y.Array + touch
  sceneObjects ..> ObjectTypeSpec : TAGGED_TYPES — пустой tags при создании
  class shapes {
    <<apps/web scene/shapes.ts>>
    SHAPE_SETS: basic, callout, flowchart, bpmn$
    SHAPE_KINDS: ShapeKind[]$
    DEFAULT_SHAPE = rectangle$
    SHAPE_KIND_KEY = myboard.shapeKind$
    shapeKind(value) ShapeKind$
    isShapeKind(value) boolean$
    shapeMarker(kind, value) string | null$
    textBoxOf(kind) TextBox$
    newShapeFields(kind) width, height, style$
    loadShapeKind() string$
    rememberShapeKind(kind) void$
  }
  class ShapeKind {
    <<interface, scene/shapes.ts>>
    id: string
    label: string
    set: ShapeSet
    width: number
    height: number
    roundable: boolean
    style?: поля оформления нового
    text?: TextBox
    verticalText?: boolean
    markers?: MarkerOption[]
  }
  class MarkerOption {
    <<interface, scene/shapes.ts>>
    id: string
    label: string
  }
  class TextBox {
    <<interface, scene/shapes.ts>>
    x, y, width, height: доли рамки
  }
  class styleOptions {
    <<apps/web scene/styleOptions.ts>>
    COLOR_KEYS = fill, stroke, color, background$
    RECENT_GROUP = Recent colors$
    objectStyleKeys(object) StyleKey[]$
    sharedStyleKeys(selected, recent) StyleKey[]$
    styleOptions(key, selected, recent) StyleOption[]$
  }
  class recentColors {
    <<apps/web scene/recentColors.ts, localStorage>>
    RECENT_COLORS_KEY = myboard.recentColors$
    RECENT_LIMIT = 8$
    ColorCategory: text | sticky | shape | line | drawing
    normalizeColor(value) string | null$
    colorCategory(type) ColorCategory | null$
    loadRecentColors() RecentColors$
    addRecentColor(recent, categories, color) RecentColors$
    useRecentColors() recent, remember$
  }
  shapes *-- ShapeKind : SHAPE_KINDS
  ShapeKind *-- MarkerOption : markers (BPMN)
  ShapeKind *-- TextBox : text
  SceneObjectMap ..> ShapeKind : shape — id вида, marker — id маркера
  ObjectTypeSpec ..> shapes : DEFAULT_SHAPE, SHAPE_KINDS — список Shape
  styleOptions ..> shapes : маркеры и скругление по виду
  styleOptions ..> recentColors : недавние цвета категории выделенных
  stickies ..> recentColors : normalizeColor
  class drawingShape {
    <<apps/web scene/drawingShape.ts>>
    BRUSHES = pen, marker$
    MARKER_OPACITY = 0.5$
    readDrawing(record, width, height) DrawingShape | null$
    touchesStroke(stroke, p, radius) boolean$
    straightStroke(start, end) Point[]$
    strokePath(points) string$
  }
  class DrawingShape {
    <<interface, scene/drawingShape.ts>>
    brush: pen | marker
    points: Point[] — в рамке, растянуты под width × height
  }
  class drawEdits {
    <<apps/web scene/drawEdits.ts>>
    createDrawing(objects, points, style: StrokeStyle, actor) string$
  }
  class StrokeStyle {
    <<interface, scene/drawEdits.ts>>
    brush: pen | marker
    color: string
    width: number
  }
  SceneObject --> DrawingShape : drawing (у остальных типов null)
  sceneObjects ..> drawingShape : readDrawing — точки × width/baseWidth, height/baseHeight
  drawingShape ..> DrawingShape
  drawEdits ..> SceneObjectMap : createObject + brush, points, baseWidth, baseHeight, без text — одной транзакцией
  drawEdits ..> sceneObjects : createObject, objectMap, transact
  drawEdits ..> StrokeStyle
  class frameOptions {
    <<apps/web scene/frameOptions.ts>>
    FRAME_TYPE = frame$
    readFrameFields(record) FrameFields$
  }
  class FrameFields {
    <<interface, scene/frameOptions.ts>>
    keepRatio: boolean
    contentHidden: boolean
    lockContent: boolean
  }
  class FrameOptions {
    <<interface, scene/frameOptions.ts>>
    contentLocked: boolean — содержимое заблокировано
  }
  class frames {
    <<apps/web scene/frames.ts>>
    isFrame(object) boolean$
    containerUnder(scene, object) Container | null$
    placeInFrames(objects, scene, ids, actor) void$
    adoptContained(objects, scene, frameId, actor) void$
    reparent(objects, scene, object, target: Container | null, actor) void$
    sendToBack(objects, scene, id) void$
    setContentHidden(objects, frames, hidden, actor) void$
    setKeepRatio(objects, frame, keep, actor) void$
    lockWithFrames(objects, units, withContent, actor) void$
    resizeKeepingRatio(frame, corner, pointer) Frame$
    frameResizeGesture(objects, frame, children, corner, actor) Gesture$
    scaledLeaves(scene, leaves) SceneObject[]$
  }
  FrameFields <|-- FrameOptions
  SceneObject --> FrameOptions : frameOptions (у остальных типов null)
  sceneObjects ..> frameOptions : readFrameFields у type frame, contentLocked, hidden — при обходе детей
  frameOptions ..> FrameFields
  frames ..> SceneObjectMap : parent, x, y, z детей, z фрейма, keepRatio, contentHidden, locked + lockContent — writeFields
  frames ..> sceneObjects : objectMap, patchObjects, writeFields, transact, touch
  frames ..> groups : ancestors
  class Container {
    <<interface, scene/frames.ts>>
    parent: SceneObject — фрейм, таблица или канбан
    cell: string | null — ключ ячейки у таблицы, id столбца у канбана
  }
  class TableCellMap {
    <<Y.Map, ячейка таблицы>>
    text?: Y.Text
    color?: string
    fontStyle?: normal | bold | italic | bold-italic | underline | strike
    align?: left | center | right
    valign?: top | middle | bottom
    fill?: string | transparent
    rowSpan?: number — у левой верхней ячейки объединения
    colSpan?: number
  }
  class TableShape {
    <<interface, scene/tableData.ts>>
    columns: TableLine[]
    rows: TableLine[]
    cells: Map~string, TableCell~
    covered: Map~string, string~ — закрытая ячейка → владелец
    width: number — сумма ширин столбцов
    height: number — сумма высот строк
  }
  class TableLine {
    <<interface, scene/tableData.ts>>
    id: string
    size: number
    start: number
  }
  class TableCell {
    <<interface, scene/tableData.ts>>
    text: string
    style: CellStyleKey → string
    rowSpan: number
    colSpan: number
  }
  class tableData {
    <<apps/web scene/tableData.ts>>
    TABLE_TYPE = table$
    DEFAULT_COLUMN_WIDTH = 160, DEFAULT_ROW_HEIGHT = 48$
    MIN_CELL_SIZE = 24, NEW_TABLE_SIZE = 3$
    CELL_STYLE_KEYS, CELL_DEFAULTS$
    cellKey(row, column), splitKey(key)$
    readTable(record) TableShape | null$
    ownerOf, cellRect, cellAt, cellIndex, keyAt$
    tableGrid(table) string[][]$
    initTable(map, grid, sizes) void$
    cellMap, cellText(map, key) Y.Text$
    syncFrame(map) — width, height = суммы$
    setLineSize, resizeTable, insertLine, deleteLine$
    expandBox, boxCells, mergeCells, unmergeCells$
    setCellStyle, clearCells$
    tableFieldValue(key, value) — вставка копии$
  }
  class tables {
    <<apps/web scene/tables.ts>>
    STICKY_GRID_STEP = 220$
    emptyGrid(rows, columns) Grid$
    createTable(objects, at, grid, actor) string$
    pasteTableGrid(objects, grid, point, gridStep, actor) string$
    stickiesFromGrid(objects, grid, point, gridStep, actor) string[]$
    selectionBox, selectedCells, neighborCell, stepCell$
    editTable(objects, table, actor, write) void$
    addLine(objects, table, axis, lineId, after, actor)$
    removeLine(objects, scene, table, axis, lineId, actor) boolean$
    mergeSelection(objects, scene, table, box, actor)$
    lineResizeGesture(objects, table, axis, lineId, start, actor) Gesture$
    editorExit, cellAfter$
  }
  class tableExchange {
    <<apps/web scene/tableExchange.ts>>
    MAX_GRID_ROWS = 500, MAX_GRID_COLUMNS = 100$
    gridToTsv(grid), gridToHtml(grid) string$
    parseTsv(text) Grid$
    parseHtmlTable(html) Grid | null$
    tabularGrid(text, html) Grid | null$
  }
  frames ..> Container
  Container --> SceneObject : parent
  SceneObjectMap *-- TableCellMap : cells (table)
  SceneObject --> TableShape : table (у остальных типов null)
  TableShape *-- TableLine
  TableShape *-- TableCell
  sceneObjects ..> tableData : readTable у type table, cellRect — сдвиг детей в ячейке, resizeTable в patchObjects
  tableData ..> SceneObjectMap : columns, rows, sizes, cells, width, height
  tableData ..> TableShape
  tables ..> tableData : initTable, insertLine, deleteLine, mergeCells, setLineSize
  tables ..> sceneObjects : createObject, objectMap, transact, touch, readScene
  tables ..> frames : placeInFrames, reparent — объекты ячеек при удалении строки и объединении
  frames ..> tableData : cellAt, cellRect — объект в ячейке (TBL-05)
  clipboard ..> tableData : readTable, tableGrid, tableFieldValue
  clipboard ..> tableExchange : gridToTsv, gridToHtml
  class KanbanShape {
    <<interface, scene/kanbanData.ts>>
    columns: KanbanColumn[]
    width: number — столбцы × COLUMN_WIDTH
    height: number
  }
  class KanbanColumn {
    <<interface, scene/kanbanData.ts>>
    id: string
    title: string
    start: number — отступ от левого края канбана
  }
  class kanbanData {
    <<apps/web scene/kanbanData.ts>>
    KANBAN_TYPE = kanban, CARD_TYPE = card$
    COLUMN_WIDTH = 280, HEADER_HEIGHT = 48, KANBAN_HEIGHT = 480$
    CARD_PADDING = 20, CARD_GAP = 12$
    DEFAULT_COLUMNS = To do, In progress, Done$
    columnId() string$
    readKanban(record) KanbanShape | null$
    columnRect(kanban, id) ColumnRect | null$
    columnAt(kanban, point) string | null$
    columnTitle(map, id) Y.Text$
    titleMap(map), columnList(map)$
    kanbanFieldValue(key, value) — вставка копии$
  }
  class kanbans {
    <<apps/web scene/kanbans.ts>>
    CARD_WIDTH = 240, NEW_COLUMN_TITLE = New column$
    createKanban(objects, at, actor) string$
    columnCards(scene, kanban, column) SceneObject[]$
    arrangeKanban(objects, kanbanId, actor) void$
    arrangeKanbans(objects, kanbans, actor) void$
    kanbansOf(scene, ids) Set~string~$
    addCard(objects, kanban, column, actor) string$
    addColumn(objects, kanban, after, actor) string | null$
    deleteColumn(board, kanban, column, fate: ColumnFate, actor) void$
  }
  class ColumnFate {
    <<type, scene/kanbans.ts>>
    move, to — карточки в конец столбца to
    delete — карточки в корзину
  }
  SceneObject --> KanbanShape : kanban (у остальных типов null)
  KanbanShape *-- KanbanColumn
  sceneObjects ..> kanbanData : readKanban у type kanban, columnRect — сдвиг карточек в столбце
  kanbanData ..> SceneObjectMap : columns, titles, width, height
  kanbanData ..> KanbanShape
  kanbans ..> kanbanData : columnList, columnTitle, titleMap, columnId
  kanbans ..> sceneObjects : createObject, objectMap, readScene, writeFields, transact, touch
  kanbans ..> BoardDocument : moveToTrash — карточки удалённого столбца
  kanbans ..> lineEdits : detachFrom
  kanbans ..> ColumnFate
  frames ..> kanbanData : columnAt — карточка в столбце (KBN-02)
  frames ..> kanbans : arrangeKanbans, kanbansOf — после placeInFrames
  clipboard ..> kanbanData : kanbanFieldValue
  class MindmapNodeMap {
    <<Y.Map, узел интеллект-карты>>
    parent: string | null — у корня null
    order: number — порядок среди братьев, дробный
    text: Y.Text — название
    color: string
    collapsed: boolean
  }
  class MindmapShape {
    <<interface, scene/mindmapData.ts>>
    root: string
    nodes: MindmapNode[] — видимые, корень первым
    byId: ReadonlyMap — все узлы по id, и скрытые
    width: number
    height: number
    anchorY: number — середина корня от верха рамки
  }
  class MindmapNode {
    <<interface, scene/mindmapData.ts>>
    id: string
    parent: string | null — после восстановления дерева
    text: string
    color: string
    collapsed: boolean
    children: string[]
    descendants: number
    depth: number
    x: number — от левого края карты
    y: number — от верха карты
    width: number
    height: number
  }
  class NodeDrop {
    <<interface, scene/mindmapData.ts>>
    target: string
    place: DropPlace — child | before | after
  }
  class mindmapData {
    <<apps/web scene/mindmapData.ts>>
    MINDMAP_TYPE = mindmap$
    NODE_HEIGHT = 40, ROOT_HEIGHT = 56$
    NODE_MIN_WIDTH = 96, NODE_MAX_WIDTH = 280$
    LEVEL_GAP = 56, SIBLING_GAP = 12, TOGGLE_SIZE = 20$
    ROOT_COLOR, NEW_ROOT_TEXT = Main topic$
    NEW_CHILD_TEXTS = Idea 1, Idea 2$
    nodeId() string$
    nodeWidth(text, root) number$
    readMindmap(record) MindmapShape | null$
    subtree(shape, id) string[]$
    dropAt(shape, dragged, point) NodeDrop | null$
    nodeMaps(mindmap) Y.Map$
    nodeMap(mindmap, id) Y.Map | null$
    nodeText(mindmap, id) Y.Text | null$
    createNode(fields) Y.Map$
    mindmapFieldValue(key, value) — вставка копии$
  }
  class mindmaps {
    <<apps/web scene/mindmaps.ts>>
    createMindmap(objects, at, actor) string$
    addChild(objects, mindmap, parent, actor) string | null$
    addSibling(objects, mindmap, sibling, actor) string | null$
    recolorNode(objects, mindmap, id, color, withChildren, actor) void$
    deleteNode(objects, mindmap, id, actor) void$
    toggleNode(objects, mindmap, id, actor) void$
    moveNode(objects, mindmap, id, drop, actor) void$
    nodeEditorStyle(object, node) CSSProperties | null$
  }
  SceneObjectMap *-- MindmapNodeMap : nodes (mindmap)
  SceneObject --> MindmapShape : mindmap (у остальных типов null)
  MindmapShape *-- MindmapNode
  sceneObjects ..> mindmapData : readMindmap у type mindmap, верх рамки по anchorY
  mindmapData ..> SceneObjectMap : root, nodes
  mindmapData ..> MindmapShape
  mindmapData ..> NodeDrop
  mindmaps ..> mindmapData : readMindmap, nodeMaps, nodeMap, createNode, subtree
  mindmaps ..> sceneObjects : createObject, objectMap, transact, touch
  mindmaps ..> NodeDrop
  clipboard ..> mindmapData : mindmapFieldValue
  class CommentThread {
    <<interface, comments/commentData.ts>>
    id: string
    anchor: CommentAnchor
    color: string
    resolved: boolean
    messages: CommentMessage[]
    createdAt: string
  }
  class commentData {
    <<apps/web comments/commentData.ts>>
    COMMENT_COLORS — Yellow … Gray$
    DEFAULT_COMMENT_COLOR = #f9a825$
    readThreads(comments) CommentThread[]$
    createThread(comments, anchor, color, author, text, now) ids$
    addReply(comments, id, author, text, now) string | null$
    setResolved(comments, id, resolved) void$
    setThreadColor(comments, id, color) void$
    anchorAt(object, at) CommentAnchor$
    pinPoint(anchor, scene) Point | null$
    participants(threads) string[]$
    filterThreads(threads, people, hideResolved) CommentThread[]$
  }
  class commentReads {
    <<apps/web comments/commentReads.ts>>
    COMMENT_READS_PREFIX = myboard.commentReads.$
    loadReads(boardId, self) Set~string~$
    unreadCount(thread, reads, self) number$
    useCommentReads(boardId, self) unread, markRead$
  }
  commentData ..> comments : чтение и запись веток
  commentData ..> CommentThread
  commentData ..> SceneObject : anchorAt, pinPoint — рамка и поворот объекта
  CommentThread *-- CommentMessage
  commentReads ..> CommentThread : чужие непрочитанные
  class FlipSideFields {
    <<поля Y.Map флип-карточки, side — front или back>>
    sideFill: string
    sideFontSize: number
    sideFontStyle: normal | bold | italic | bold-italic | underline | strike
    sideColor: string
    sideAlign: left | center | right | justify
    sideImage: string | null — data URL изображения
  }
  class ReactionShape {
    <<interface, scene/reactionData.ts>>
    image: string
  }
  class reactionData {
    <<apps/web scene/reactionData.ts>>
    REACTION_TYPE = reaction$
    REACTION_SETS — Emotions, Votes, Stamps по 8$
    ALL_REACTIONS, DEFAULT_REACTION$
    REACTION_MIN = 48, REACTION_MAX = 240, HOLD_DELAY = 250$
    reactionImage(value) ReactionImage | null$
    reactionSize(elapsed) number$
    readReaction(record) ReactionShape | null$
    reactionTitle(object) string — Название by имя$
  }
  class reactions {
    <<apps/web scene/reactions.ts>>
    canReactTo(object) boolean — не line, group, reaction$
    createReaction(objects, target, center, size, image, actor) string$
  }
  class reactionChoice {
    <<apps/web scene/reactionChoice.ts, localStorage>>
    REACTIONS_KEY = myboard.reactions$
    RECENT_REACTIONS_LIMIT = 8$
    loadReactionChoice() ReactionChoice$
    withRecent(choice, image) ReactionChoice$
    useReactionChoice() choice, pick, used$
  }
  class FlipShape {
    <<interface, scene/flipData.ts>>
    flipped: boolean
    direction: FlipDirection
    front: FlipSide
    back: FlipSide
  }
  class FlipSide {
    <<interface, scene/flipData.ts>>
    text: string
    fill, color, fontStyle, align: string
    fontSize: number
    image: string | null
  }
  class flipData {
    <<apps/web scene/flipData.ts>>
    FLIP_TYPE = flipcard$
    FLIP_DIRECTIONS — Horizontal, Vertical$
    NEW_SIDES — front #ffffff, back #81d4fa$
    STYLE_FIELDS$
    sideKey(side, field) string$
    sideTextKey(side) text | backText$
    shownSide(flip) FlipSideName$
    readFlip(record) FlipShape$
    isImageUrl(value) boolean — только data URL изображения$
  }
  class flipCards {
    <<apps/web scene/flipCards.ts>>
    createFlipCard(objects, at, actor) string$
    flipCards(objects, cards, actor) void$
    setFlipFields(objects, card, side, fields, actor) void$
    sideText(objects, id, side) Y.Text | null$
  }
  class imageFile {
    <<apps/web scene/imageFile.ts>>
    IMAGE_MAX_SIDE = 640$
    imageToDataUrl(file) Promise~string~$
  }
  class DiceShape {
    <<interface, scene/diceData.ts>>
    faces: number
    value: number | null
    roll: number
  }
  class diceData {
    <<apps/web scene/diceData.ts>>
    DICE_TYPE = dice$
    DICE_FACES = 4, 6, 8, 10, 12, 20$
    DEFAULT_FACES = 6$
    readDice(record) DiceShape$
    diceTitle(object) string$
  }
  class dice {
    <<apps/web scene/dice.ts>>
    createDice(objects, at, actor, faces) string$
    cryptoRandom: RandomSource — crypto.getRandomValues$
    rollValue(faces, random) number$
    rollDice(objects, dice, actor, random) void$
    setFaces(objects, dice, faces, actor) void$
    diceSum(dice) number$
  }
  SceneObjectMap ..> SceneObjectMap : parent — объект под реакцией (reaction)
  SceneObjectMap *-- FlipSideFields : front…, back… (flipcard)
  SceneObject --> ReactionShape : reaction (у остальных типов null)
  SceneObject --> FlipShape : flip (у остальных типов null)
  SceneObject --> DiceShape : dice (у остальных типов null)
  FlipShape *-- FlipSide : front, back
  sceneObjects ..> reactionData : readReaction у type reaction
  sceneObjects ..> flipData : readFlip у type flipcard, text — обе стороны
  sceneObjects ..> diceData : readDice у type dice
  reactionData ..> ReactionShape
  flipData ..> FlipShape
  diceData ..> DiceShape
  reactions ..> sceneObjects : createObject, objectMap, transact
  reactions ..> SceneObjectMap : parent, x, y, width = height, image, без text — одной транзакцией
  reactionChoice ..> reactionData : reactionImage — чужие отбрасываются
  flipCards ..> SceneObjectMap : backText, flipped, direction, поля сторон + touch
  flipCards ..> sceneObjects : createObject, objectMap, touch, transact
  flipCards ..> flipData : NEW_SIDES, sideKey, sideTextKey
  imageFile ..> FlipSideFields : sideImage — уменьшенная копия файла (FlipControls)
  reactions ..> reactionData : REACTION_TYPE
  dice ..> SceneObjectMap : faces, value, roll + touch — одной транзакцией
  dice ..> sceneObjects : createObject, objectMap, touch, transact
  dice ..> diceData : DICE_FACES, DEFAULT_FACES
  clipboard ..> SceneObjectMap : backText — Y.Text при вставке (flipcard)
  class noteData {
    <<apps/web notes/noteData.ts>>
    OPEN_FOR_ALL = openForAll$
    NOTE_CLIENT_ID = 0
    noteUpdate Uint8Array | null
    createNoteUpdate() Uint8Array
    isCanonical(text) boolean
    noteText(notes) Y.XmlText | null$
    ensureNoteText(notes) Y.XmlText$
    isNoteOpenForAll(notes) boolean$
    setNoteOpenForAll(notes, open) void$
    noteOps(notes) DeltaOp[]$
    checkNoteItem(notes, end, checked) void$
  }
  notes *-- NoteText
  NoteText ..> RichTextContent : та же модель текста и блоков документа
  noteData ..> notes : чтение и запись заметки
  noteData ..> NoteText : создание одним обновлением от clientID 0
```

- Корни объявлены в `BoardDocument` как `unknown`; поля объекта сцены разбирает модуль `scene` (T5.2). Объект в `objects` — `Y.Map`, каждое поле — свой ключ, чтобы одновременные правки разных полей не затирали друг друга (COL-01): `type` — `sticky` | `shape` | `text` | `document` | `stack` | `line` | `drawing` | `frame` (`OBJECT_TYPES` в `scene/objectTypes.ts`, `document` — T6.1, `stack` — T6.2, `line` — T6.4, `drawing` — T6.5, `frame` — T6.6, `table` — T6.7, `kanban`, `card` — T6.8, `mindmap` — T6.9, `reaction`, `flipcard`, `dice` — T6.11) или `group` (`GROUP_TYPE`, T5.3; другие типы — T7.*), `parent` (`null` — верхний уровень; `x`, `y` дочернего — относительно родителя, `readScene` прибавляет позиции предков, цикл и потерянный родитель дают 0), `width`, `height`, `rotation` (градусы вокруг центра, по умолчанию 0), `z` (целое; новый — `topZ` = наибольший `z` + 1, учитываются и записи-JSON, BUG-008), оформление по типу (`sticky` — `fill`, `fontSize`; `stack` — `fill`; `shape` — `shape`, `marker`, `fill`, `stroke`, `strokeWidth`, `radius`, `fontSize`, `color`, `align`, `lineHeight`, T6.3; `text` и `document` — `fontFamily`, `fontSize`, `color`, `fontStyle`, `align`, `lineHeight`, `background`, T6.1), `text` — `Y.Text` (у фигуры правки сливаются по символам: `applyTextChange` меняет только изменившуюся середину, `shiftIndex` держит курсор при чужой правке; у текста, документа и стикера — см. ниже; у стопки — пустой).
- Текст и документ (T6.1, TXT-01…TXT-08): `text` — тот же `Y.Text`, но с атрибутами в модели Quill (`RichTextContent`): начертание и ссылка — на символах, `header` 1–3, `list` (`bullet` | `ordered` | `checked` | `unchecked`) и `indent` 1–8 — на переводе строки своей строки; в документе ещё вставки `{ divider: true }` и `{ objectLink: id }` (id ключа в `objects`, TXT-06). Новых корней и полей-контейнеров нет; `toJSON()` текста — по-прежнему строка (поиск, подпись объекта). `readScene` кладёт дельту (`Y.Text.toDelta()`) в `SceneObject.rich` только для `RICH_TEXT_TYPES`; показ (`toBlocks`) отбрасывает неизвестные атрибуты, ссылки — только http(s), mailto, tel. Правка в редакторе (`bindQuill`) пишет в `Y.Text` минимальную разницу «было → стало» (`minimalChange`, BUG-014) одной транзакцией с origin `null` вместе с `touch` и подгонкой `height`; отметка пункта списка дел на холсте (TXT-02) — `text.format(end, 1, {list})` + `touch` одной транзакцией. Высота: текстовый блок следует за содержимым, документ только растёт; подгонка после смены оформления и вставки HTML (`useTextFit`) входит в тот же шаг отмены (`UndoHistory.amend`).
- Стикер (T6.2, STK-01…STK-04): `type: "sticky"`, `text` — `Y.Text` с атрибутами Quill, как у текста (`RICH_TEXT_TYPES` = `text`, `document`, `sticky`; правка — `bindQuill`, подгонки высоты нет: `fittedHeight` для стикера — `null`). `fill` — цвет, выбранный до постановки (`STICKY_COLORS` — палитра без чёрного; выбор вкладки — `sessionStorage` `myboard.stickyColor`, в документ не входит). `fontSize` — число или `"auto"` (`AUTO_FONT_SIZE`, у нового — `"auto"`): автоподгон считает каждый клиент при отрисовке (`useFitFont`), в документ размер не пишется. `showAuthor: false` — имя автора (`createdBy`) на стикере скрыто; нет поля — показано. `tags` — `Y.Array<string>`, у нового стикера и стопки создаётся пустым сразу в `createObject` (`TAGGED_TYPES`), чтобы первые теги двух участников слились в один массив (COL-01). Следующий стикер по Tab (`createNextSticky`, STK-04) — справа на `NEXT_STICKY_GAP` = 20, тех же `width`, `height`, `fill`, `fontSize`, `showAuthor`, без тегов, одной транзакцией.
- Фигура (T6.3, SHP-01…SHP-04): `type: "shape"`. `shape` — id вида из `SHAPE_KINDS` (`scene/shapes.ts`): наборы `basic` (Basic, 15 видов), `callout` (Callouts, 4), `flowchart` (Flowchart, 17), `bpmn` (BPMN, 11: `bpmn-task`, `bpmn-subprocess`, `bpmn-start`, `bpmn-intermediate`, `bpmn-end`, `bpmn-gateway`, `bpmn-data-object`, `bpmn-data-store`, `bpmn-pool`, `bpmn-annotation`, `bpmn-group`); нет поля или неизвестный id — `rectangle` (`shapeKind`), поэтому фигуры до T6.3 показываются прямоугольником. `marker` — id маркера BPMN (`ShapeKind.markers`: у задачи, подпроцесса, событий, шлюза и объекта данных; первый — по умолчанию, у шлюза — `exclusive`, у остальных — `none`); чужой или пустой — первый маркер вида (`shapeMarker`), у видов без маркеров поле не читается. Оформление: `fill` — цвет или `"transparent"` (`NO_COLOR`, SHP-03), `stroke`, `strokeWidth` (0 — без обводки; 0, 1, 2, 4, 6, 8), `radius` (скругление 0…48, читается только у видов с `roundable`), `fontSize`, `color`, `align`, `lineHeight`. Новая фигура (`newShapeFields`) — размер вида (`width`, `height`, передаётся в `createObject` аргументом `size`), оформление типа `shape` поверх него — `ShapeKind.style` вида, `shape` и маркер по умолчанию; всё одной транзакцией `createObject`. `text` — `Y.Text` без атрибутов (правка — `TextEditor` с `applyTextChange`, как раньше), поле правки — над областью текста вида (`TextBox` в долях рамки; у событий, шлюза и данных — подпись под фигурой). Контур и значки маркеров клиент вычисляет при отрисовке (`shapeGeometry.ts`, `bpmnMarkers.ts`) и в документ не пишет. Выбранный до постановки вид — `sessionStorage` `myboard.shapeKind` (`loadShapeKind`), в документ не входит.
- Соединительная линия (T6.4, CON-01…CON-07, CVS-26): `type: "line"`, `x`, `y` — положение линии, `width`/`height` — 0, `rotation` не пишется (`patchObjects` пропускает `width`, `height`, `rotation` линии — `derivedFrame`): рамку на сцене `readScene` вычисляет по точкам маршрута (`pointsBounds(routeOf(line))`). `start`, `end` — JSON `LineEnd` `{x, y}` относительно `x`, `y` линии; у привязанного конца ещё `object` (id ключа в `objects`) и `anchor` (`n` | `e` | `s` | `w` — середина стороны рамки с учётом поворота). `points` — JSON-массив точек изгиба относительно линии. Оформление: `lineStyle` (`straight` | `elbow` | `curved`), `startCap`/`endCap` (`none` | `arrow` | `triangle` | `circle` | `diamond`; у новой — `none`/`arrow`), `stroke`, `strokeWidth` (без 0). `labels` — `Y.Map` id → `Y.Map` подписи (`LineLabelMap`: `text` — `Y.Text`, правки сливаются по символам; `position` — доля длины 0…1; `orientation`, `align`, `fontFamily`, `fontSize`, `color`). `text` линии — пустой `Y.Text` от `createObject`; `SceneObject.text` линии — тексты подписей через перевод строки (поиск, CVS-08). Новая линия (`createLine`) — `createObject` + `start`, `end`, `points: []` одной транзакцией.
- Привязка (CVS-26) в документе — только `object`/`anchor` конца: `readScene` собирает рамки всех объектов, кроме линий и групп (`connectableFrames`, `isConnectable`), и `resolveLine` ставит привязанный конец в точку привязки текущей рамки объекта; запасные `x`, `y` конца — если объекта нет. Поэтому движение объекта не пишет в линию, а линия следует за ним у всех участников. `detachLine` и `detachFrom` записывают текущие точки концов свободными; `SceneCommands.remove` вызывает `detachFrom` в одной транзакции с `moveToTrash`. `swapEnds` меняет `start`/`end`, разворачивает `points`, подписям ставит `position = 1 − position`; наконечники не меняются. Запись-JSON подписей при первой правке заменяется `Y.Map` (`labelsMap`, `labelEntry`). Состояние вкладки (выбранная подпись `LabelState`, точки привязки под концом `ConnectHint`) в документ не входит.
- Рисунок (T6.5, DRW-01…DRW-04, DRW-06): `type: "drawing"` — один штрих пера или маркера. `x`, `y`, `width`, `height` — описанный прямоугольник точек (не меньше 1×1), `rotation`; `points` — плоский JSON-массив `[x0, y0, x1, y1, …]` относительно рамки, с точностью 0,1; `baseWidth`, `baseHeight` — размер рамки, в котором штрих нарисован; `brush` — `pen` | `marker` (маркер рисуется с `stroke-opacity` `MARKER_OPACITY` = 0.5); `stroke` — цвет, `strokeWidth` — толщина. Поля `text` нет: `createDrawing` удаляет `Y.Text`, созданный `createObject`. Одна точка (касание без движения) пишется дважды — отрезок нулевой длины с круглым концом. `readDrawing` растягивает точки на `width / baseWidth` и `height / baseHeight`, поэтому изменение размера (`patchObjects`) растягивает штрих, в том числе неравномерно, а толщина не меняется (DRW-06); испорченные точки — `drawing: null`, штрих не рисуется. Штрих пишется одной транзакцией при отпускании (`createDrawing`): черновик `InkDraft` и прямой отрезок с Shift (DRW-04, две точки) — состояние вкладки. Ластик (DRW-03) переносит задетые незаблокированные штрихи целиком в `trash` (`moveToTrash` вместе с `detachFrom` одной транзакцией), частичного стирания нет. Типа `drawing` нет среди `PlaceableType`: щелчком и из меню он не ставится.
- Фрейм (T6.6, FRM-01…FRM-05): `type: "frame"`, рамка `x`, `y`, `width`, `height` (новый — 640×480 центром в точке), `rotation` не меняется (`rotatable: false`), `z`; `appearance` — `fill` | `border` | `outline` (FRM-02: фон цветом; граница цветом и белый фон; граница цветом без фона), `fill` — цвет (у нового `appearance: fill`, `fill: #ffffff`); `keepRatio` — размер за угол в прежнем соотношении сторон (FRM-03); `contentHidden` — содержимое скрыто у всех (FRM-04); `lockContent` — при `locked: true` блокировка переходит на содержимое (FRM-05; нет поля — `true`, как у группы; `false` — «Frame only»). Поля `text` нет в показе (`editable: false`, `Y.Text` от `createObject` пустой). Дети фрейма — объекты с `parent` = id фрейма, `x`, `y` относительно его левого верхнего угла, `z` — среди детей; `readScene` отдаёт фрейм перед его детьми, поэтому они двигаются вместе с ним (FRM-01) без записи в детей. Попадание во фрейм (`placeInFrames`) — после перемещения, постановки или штриха: объект верхнего уровня или ребёнок фрейма, не фрейм, не линия, не заблокированный, переходит к верхнему фрейму под центром своей рамки (`containerUnder`, с T6.7 — фрейм или ячейка таблицы) или на верхний уровень, когда центр снаружи; `reparent` пишет `parent`, `x`, `y` в новой системе координат (на доске объект на месте), `z` — поверх новых соседей, и `touch`. Фрейм со скрытым содержимым или заблокированный вместе с содержимым (`FrameOptions.contentLocked`) новых объектов не принимает; вложенных фреймов нет. Новый фрейм в той же транзакции, что `createObject`, встаёт под объекты верхнего уровня (`sendToBack`: `z` = наименьший − 1) и забирает лежащие в нём целиком (`adoptContained`). Изменение размера одного фрейма (`frameResizeGesture`) переписывает `x`, `y` его детей, когда сдвинулся левый верхний угол, — на доске они остаются на месте; при масштабе нескольких выделенных дети выделенного фрейма не масштабируются (`scaledLeaves`). `readScene`: `SceneObject.frameOptions` — поля фрейма и `contentLocked`, `hidden` — у всех потомков фрейма с `contentHidden` (их не рисуют, не выделяют, не ищут: `BoardScene` отдаёт сцене, поиску и жестам только `visible`). Удаление и копирование фрейма — с его детьми, как у группы (`removalSet`, `copyObjects`).
- Таблица (T6.7, TBL-01…TBL-07): `type: "table"`, `x`, `y`, `z`, `rotation` не меняется (`rotatable: false`), `editable: false` (`Y.Text` объекта пустой). `columns`, `rows` — `Y.Array<string>` id столбцов и строк по порядку; `sizes` — `Y.Map` id линии → ширина столбца или высота строки (не меньше `MIN_CELL_SIZE` = 24; новая — 3×3 по 160×48); `width`, `height` — суммы размеров, их пересчитывает `syncFrame` при каждой правке структуры, а `readScene` берёт рамку из `TableShape`, поэтому `patchObjects` их не пишет (`derivedFrame`): размер за угол (CVS-14) — `resizeTable`, пропорционально всем столбцам и строкам. `cells` — `Y.Map` ключ `"<id строки>:<id столбца>"` → `Y.Map` ячейки (`TableCellMap`): `text` — `Y.Text` без атрибутов (правка — `TextEditor` `Table cell` поверх ячейки, `touch` таблицы), оформление ячейки `color`, `fontStyle`, `align`, `valign`, `fill` (TBL-02, TBL-03; нет поля — `CELL_DEFAULTS`), `rowSpan`/`colSpan` у левой верхней ячейки объединения. Пустой ячейки в `cells` может не быть — её `Y.Map` создаётся при первой правке (`cellMap`). Объединение (`mergeCells`) дописывает текст закрытых ячеек в левую верхнюю с новой строки и удаляет их записи; разъединение (`unmergeCells`) снимает `rowSpan`/`colSpan`. Добавление строки или столбца (`insertLine`) — новый id в `rows`/`columns`, размер соседа, объединения через линию растягиваются; удаление (`deleteLine`) — удаляет id, размер и ячейки линии, объединения сжимаются; последнюю строку и последний столбец не удаляют. Каждая правка структуры — одна транзакция с `touch` таблицы (`editTable`). Объект в ячейке (TBL-05): `parent` = id таблицы, `cell` — ключ ячейки, `x`, `y` — относительно её левого верхнего угла; `readScene` прибавляет `cellRect` ячейки, поэтому объект едет с таблицей и с ячейкой при изменении размеров без записи в объект. `containerUnder` выбирает верхний фрейм или ячейку под центром объекта (таблица в таблицу не попадает, заблокированная таблица не принимает), `reparent` пишет `parent`, `cell`, `x`, `y`, `z`; выход из таблицы удаляет `cell`. Объединение переносит объекты закрытых ячеек в объединённую (`mergeSelection`), удаление строки или столбца переносит объекты её ячеек к родителю таблицы (`removeLine`); ключ ячейки, которой больше нет, читается как угол таблицы. Группа в ячейке тоже получает `cell`, дубликат — `cell` оригинала. `SceneObject.text` таблицы — тексты ячеек через перевод строки (поиск, CVS-08). Копия (TBL-06) — JSON полей таблицы (`tableFieldValue` при вставке снова делает `Y.Array`/`Y.Map`/`Y.Text`), корень копии без `cell`; в системный буфер — ещё TSV (`gridToTsv`) и HTML `<table>` (`gridToHtml`). Внешняя таблица из буфера (`tabularGrid`: HTML `<table>` или текст с табуляцией, до 500 × 100) — в документ попадает только после выбора: новая таблица (`pasteTableGrid`) или стикеры на непустые ячейки с шагом `STICKY_GRID_STEP` = 220 (`stickiesFromGrid`, TBL-07), одной транзакцией с `placeInFrames`. Выделенные ячейки, активная ячейка и ячейка ввода — состояние вкладки, в документ не входят.
- Канбан (T6.8, KBN-01…KBN-03): `type: "kanban"`, `x`, `y`, `z`, `height` (новый — 480), `rotation` не меняется (`rotatable: false`), `editable: false`, поля `text` нет (`createKanban` удаляет его после `createObject`). `columns` — `Y.Array<string>` id столбцов слева направо (новый — три: `To do`, `In progress`, `Done`); `titles` — `Y.Map` id столбца → `Y.Text` названия (правки названия сливаются по символам, правка — `TextEditor` `Column title` поверх заголовка). `width` = число столбцов × `COLUMN_WIDTH` (280) — пишется при добавлении и удалении столбца; `readScene` берёт рамку из `KanbanShape`. `SceneObject.text` канбана — названия столбцов через перевод строки (поиск, CVS-08). Карточка (KBN-02): `type: "card"`, 240×96, `fill` (`#ffffff`), `text` — `Y.Text` без атрибутов, `tags` — `Y.Array<string>` (как у стикера, STK-03). Карточка в столбце: `parent` = id канбана, `cell` = id столбца, `x`, `y` — относительно левого верхнего угла столбца (`columnRect`, `slotRect` в `readScene`), поэтому карточки едут с канбаном и со своим столбцом при добавлении столбца левее без записи в карточку. В столбец попадают только карточки (`containerUnder` → `columnAt`, заблокированный канбан не принимает, канбан не попадает в таблицу); после `placeInFrames`, удаления, дубликата и `addCard` затронутые канбаны перестраиваются (`arrangeKanbans`): карточки столбца по порядку середины по вертикали (при равенстве — `z`) встают с `x` = 20, первая `y` = 48, шаг — высота + 12, ширина 240; карточка, чей столбец удалили одновременно, уходит в первый столбец; `height` канбана растёт, если карточки не помещаются (сама не уменьшается). Добавление столбца (`addColumn`) — новый id справа от выбранного или последним, название `New column`; удаление (`deleteColumn`, не последнего) — одной транзакцией убирает id из `columns` и `titles`, а карточки по `ColumnFate` переходят в конец другого столбца или уходят в корзину вместе с `detachFrom` привязанных линий. Копия канбана — с карточками; `kanbanFieldValue` при вставке снова делает `Y.Array`/`Y.Map`/`Y.Text`. Выбранный столбец и столбец в правке — состояние вкладки, в документ не входят.
- Интеллект-карта (T6.9, MAP-01…MAP-04): `type: "mindmap"`, `x`, `y` — середина левого края корня (корень стоит на месте, когда дерево растёт или сворачивается), `z`; `width`, `height`, `rotation` не пишутся (`derivedFrame`), `rotatable: false`, `editable: false`, поля `text` нет (`createMindmap` удаляет его после `createObject`). `root` — id корня, `nodes` — `Y.Map` id узла → `Y.Map` узла (`MindmapNodeMap`): `parent` (у корня `null`), `order` — дробный порядок среди братьев (вставка между соседями не трогает их), `text` — `Y.Text` (правки названия сливаются по символам), `color`, `collapsed` (MAP-03, свёрнуто у всех участников). Каждый узел — свой `Y.Map`, поэтому одновременные правки разных узлов не затирают друг друга. Положения узлов не хранятся: `readMindmap` строит дерево (узел, чья цепочка родителей не доходит до корня — родитель удалён или два участника вложили узлы друг в друга, — показывается дочерним узлом корня) и раскладывает его — корень слева, дети правее на `LEVEL_GAP` друг под другом через `SIBLING_GAP`, родитель по середине высоты своих видимых детей; рамка объекта на сцене — `MindmapShape.width`/`height`, её верх — `y − anchorY`. Новая карта (`createMindmap`): корень `Main topic` и дети `Idea 1`, `Idea 2` цвета `ROOT_COLOR` (`#81d4fa`), верх рамки — в точке постановки. Операции `scene/mindmaps.ts` — одна транзакция с `touch` карты (CVS-22): `addChild` (в конец детей, цвет родителя, свёрнутый родитель раскрывается), `addSibling` (сразу после узла), `deleteNode` (узел с веткой, корень не удаляется), `moveNode` (`NodeDrop`: `child` — в конец детей цели, `before`/`after` — среди её братьев, в свою ветку и перенос корня не допускаются), `toggleNode`, `recolorNode` (`withChildren` — и все узлы под ним, MAP-04). Поиск (CVS-08) ищет по названиям всех узлов. Копия (CVS-20) переносит `nodes` Y-типами (`mindmapFieldValue`). Интеллект-карта не входит в ячейку таблицы.
- Реакция (T6.11, RCT-01…RCT-04): `type: "reaction"` — дочерний объект того, на что её поставили: `parent` = id объекта (не линии, группы и другой реакции — `canReactTo`; нажатие на реакцию ставит новую на её объект), `x`, `y` — относительно записанного положения родителя (у группы и карты — с поправкой на `offset`), центр — в точке нажатия. `width` = `height` — размер, до которого её вырастили удержанием (RCT-03: `reactionSize` — 48 при щелчке, после `HOLD_DELAY` = 250 мс растёт на 160 ед./с до 240; черновик роста `ReactionDraft` — состояние вкладки, в документ пишется только при отпускании). `image` — символ эмодзи из `REACTION_SETS` (`Emotions`, `Votes`, `Stamps`); чужое значение `readReaction` не показывает (`reaction: null`). Поля `text` нет (`createReaction` удаляет его после `createObject`), `rotatable: false`, `editable: false`. Автор (RCT-02) — `createdBy` (CVS-22), подпись `reactionTitle` — `<Название> by <имя>`. Как дочерний объект реакция едет с родителем (и во фрейме), копируется и уходит в корзину вместе с ним (`removalSet`, `copyObjects`); сама не перетаскивается, во фреймы и ячейки не переходит (`movable` в `frames.ts`), инструментом создания и меню не ставится (`PlaceableType` без `reaction`). Выбранное изображение и 8 недавних (RCT-04) — не данные документа: `localStorage` `myboard.reactions` = `{current, recent}` (`reactionChoice.ts`).
- Флип-карточка (T6.11, FLP-01…FLP-03): `type: "flipcard"`, 240×160, `rotatable: false`. `text` — `Y.Text` лицевой стороны, `backText` — `Y.Text` оборота (обе без атрибутов, правки сливаются по символам; правка — `TextEditor` `Flip card side text` поверх карточки, правится показанная сторона — `sideText` создаёт `Y.Text`, если его нет). `flipped` — показан оборот (FLP-02, общий для всех участников), `direction` — `horizontal` (поворот вокруг вертикальной оси) или `vertical`. У каждой стороны свои ключи (`FlipSideFields`, FLP-03): `frontFill`, `frontFontSize`, `frontFontStyle`, `frontColor`, `frontAlign`, `frontImage` и те же с `back`; нет поля — `NEW_SIDES` (лицевая `#ffffff`, оборот `#81d4fa`, 24, `normal`, `#1f2937`, `center`). Картинка стороны (FLP-01) — data URL `data:image/…` до 640 px по большей стороне (`imageToDataUrl`: PNG, крупный — JPEG 0.85) и хранится в документе по решению владельца (Q-006; перенос в `media` — T7.5); `readFlip` берёт только `data:image/` (`isImageUrl`). Новая карточка (`createFlipCard`) — `createObject` + `backText`, `flipped: false`, `direction: horizontal` и поля обеих сторон одной транзакцией, вместе с `placeInFrames`. `flipCards` переворачивает все выделенные незаблокированные одной транзакцией с `touch`; `setFlipFields` пишет поля показанной стороны или `direction` одной карточки. `SceneObject.text` — тексты обеих сторон через перевод строки (поиск, CVS-08). Копия переносит `backText` как `Y.Text` (`fieldValue` в `clipboard.ts`).
- Кубик (T6.11, DICE-01…DICE-03): `type: "dice"`, 96×96, `rotatable: false`, `editable: false`, поля `text` нет. `faces` — 4, 6, 8, 10, 12 или 20 (`DICE_FACES`, у нового — 6; чужое — 6), `fill` — цвет (у нового `#ffffff`, общий список Fill), `value` — последнее выпавшее значение (`null` — не бросали; вне 1…`faces` `readDice` читает как `null`), `roll` — номер броска (растёт с каждым броском, чтобы бросок с прежним значением тоже показал анимацию). Бросок (`rollDice`, DICE-02) — `rollValue`: равномерное 1…N из `crypto.getRandomValues` с отбрасыванием хвоста диапазона, запись `value`, `roll` и `touch` всех выделенных незаблокированных кубиков одной транзакцией; одновременные броски двух участников Yjs сводит к одной записи поля, поэтому значение у всех одно. `setFaces` меняет грани и сбрасывает `value`. Сумма (DICE-03, `diceSum`) — сумма `value` выделенных кубиков, не брошенный — 0; в документ не пишется.
- Недавние свои цвета (T6.3, SHP-04) — не данные документа: `localStorage` `myboard.recentColors` = `{"text":[],"sticky":[],"shape":[],"line":[],"drawing":[]}` (`#rrggbb`, до 8 в категории, последний — первым), общие для всех досок браузера. Категория — по типу объекта (`colorCategory`: `text`/`document` → `text`, `sticky`/`stack` → `sticky`, `shape` → `shape`, `line` → `line`, `drawing` → `drawing`, T6.5). Настройки пера и маркера (цвет, три пресета толщины, выбранный пресет) и режим «стилус сразу рисует» — тоже не данные документа: `localStorage` `myboard.drawSettings` (`drawSettings.ts`, DRW-02, MOB-05). В документ попадает только сам цвет в поле объекта (`fill`, `stroke`, `color`, `background` через `setStyle`); цвет следующего стикера (`stickyColor`) принимает и свой `#rrggbb`.
- Стопка стикеров (T6.2, STK-05): `type: "stack"`, рамка 200×200, `fill`, `tags` (`Y.Array<string>`), `text` пустой (`editable: false` — поле правки не открывается). Стикер из стопки (`pullSticky`) — новый `sticky` верхнего уровня размера типа, центром в точке, `fill` стопки и копия её тегов, одной транзакцией; сама стопка не меняется.
- Новый текст (TXT-05) получает `fontSize` и `color` из `sessionStorage` `myboard.textStyle` (`loadTextStyle`; запоминаются при выборе у текстового блока) — это поля объекта, сама память вкладки в документ не входит. `createObject` принимает текст строкой или дельтой и оформление поверх значений типа; вставка HTML внешнего документа (`htmlToDelta`, TXT-08) создаёт `text` с дельтой и оценкой высоты (`estimateHeight`) одной транзакцией.
- Id объекта — 32 hex-символа из `crypto.getRandomValues` (16 байт; `randomUUID` без HTTPS недоступен). `createObject` ставит объект верхнего уровня одной транзакцией (CVS-09). `patchObjects` пишет рамку и оформление нескольких объектов одной транзакцией (CVS-11, CVS-12, CVS-14), переводя `x`, `y` доски в координаты относительно родителя. Запись-JSON (как в тестах T5.1) читается так же и при первой правке заменяется `Y.Map` (`objectMap`, строка `text` → `Y.Text`). Неверные записи (нет `type` или числовой рамки) `readScene` пропускает.
- Группа (T5.3, CVS-17): `type: "group"`, `parent`, `x`, `y` — начало координат её объектов, `z` — среди соседей, `rotation: 0`, `width`/`height` — только на момент создания: рамку группы `readScene` считает по её объектам (`SceneObject.offset` — сдвиг рамки от записанного положения), пустая группа не рисуется. Объекты группы — `parent: <id группы>`, `x`, `y` относительно группы, `z` — порядок среди объектов группы (`readScene` отдаёт группу перед её объектами, соседей — по `z`, при равенстве по id). `groupObjects` ставит группу на `z` верхнего из объединяемых и нумерует объекты 1…n; `ungroupObjects` переносит объекты к родителю группы на её место в порядке слоёв (`renumber`) и удаляет группу. Группировать можно 2+ незаблокированных объекта одного родителя (`canGroup`).
- Порядок слоёв (CVS-18): `reorder` переставляет соседей одного `parent` (front/forward/backward/back), `renumber` подбирает целые `z` с наименьшим числом изменённых объектов; запись — `writeFields` одной транзакцией.
- Блокировка (CVS-19): `locked: true` у самого объекта; `SceneObject.locked` истинно и у объектов внутри заблокированной группы и заблокированного фрейма с `lockContent` ≠ `false` (FRM-05). Блокировка выделения с фреймом — `lockWithFrames`: фрейму `locked: true` и `lockContent` по выбору, остальным — `locked: true`. `setLocked`, `unlockAll` (все ключи с `locked: true`) пишут через `writeFields`. Заблокированные объекты команды и жесты не меняют и не удаляют (`removalSet` оставляет группу с заблокированным объектом целиком).
- Теги (T5.5, CVS-08): необязательное поле `tags` объекта — `Y.Array<string>` (запись-JSON — массив строк), тег без «#». `readScene` (`readTags`) берёт только строки, обрезает пробелы, отбрасывает пустые и повторы; нет поля или не массив — `[]`. Интерфейс пишет теги стикера и стопки (T6.2, STK-03): `addTag` — `normalizeTag` (без «#» в начале, пробелы схлопнуты, до 40 символов, пустой отвергается), повтор не добавляется, `Y.Array.push` + `touch` одной транзакцией; `removeTag` удаляет все повторы. Запись-JSON массива при первой правке заменяется `Y.Array` (`tagArray`); вставка из буфера (`pasteObjects`) тоже кладёт `Y.Array`. Теги карточек — KBN-02, T6.8. `searchScene` читает `text` и `tags` из `SceneObject` и в документ не пишет; ссылка на объект (SHR-07) — id ключа в `objects`, в документ тоже не входит.
- Автор и даты (CVS-22): `createdBy`, `createdAt`, `updatedBy`, `updatedAt` — имя участника (`BoardScene.userName`: имя `Peer` из присутствия, до него — имя из сессии страницы) и ISO 8601. Создание (`createObject`, `groupObjects`, `pasteObjects`) пишет все четыре (`creationMeta`), любая правка — `updatedBy`/`updatedAt` (`touch` в `writeFields`/`patchObjects`, в транзакции правки текста `TextEditor.onEdit`, в `groupObjects`/`ungroupObjects`). У объектов, записанных до T5.3, полей нет. Пишет их клиент — сервер документ не разбирает.
- Буфер обмена (CVS-20): `copyObjects` берёт выделенные корни (`topmost`) с вложенными; корни — в координатах доски, вложенные — относительно родителя, без `parent`, `locked`, автора и дат. Копия — JSON `Clip` в системном буфере (тип `CLIPBOARD_MIME` + простой текст) и в `localStorage` `myboard.clipboard` — оттуда её вставляет другая доска того же браузера. `pasteObjects` создаёт объекты с новыми id одной транзакцией: корни — поверх остальных (`topZ`), центром в точку вставки с углом на сетке, дубликат (`DUPLICATE_OFFSET`) — со сдвигом 20 в той же группе; `text` — `Y.Text`, автор — вставивший, без блокировки. Текст с форматированием (T6.1) копируется в `fields.text` дельтой (`isRich`), простой — строкой; у линии (T6.4) концы копируются в их текущем положении, привязка остаётся только к объекту, скопированному вместе с линией (`clipEnd`), при вставке — к его новому id (`pastedEnd`), подписи — `Y.Map` с `Y.Text` (`labelsValue`); вставка восстанавливает `Y.Text` через `applyDelta` (`parseDelta` отвергает чужое). В системный буфер, кроме JSON, — `text/plain` (`clipText`, ссылка на объект — её подпись) и `text/html` (`clipHtml` → `deltaToHtml`, TXT-07). `parseClip` отвергает чужой формат, берёт не больше 5000 объектов. Вырезание — копия + `moveToTrash`.
- Корень `settings` (CVS-06, ответ на Q-002): `background` — `#rrggbb` (`BACKGROUNDS`: Light gray `#fafafa` по умолчанию, White, Cream, Mint, Sky, Dark), `gridStep` — шаг сетки в единицах доски (0 — без сетки и прилипания, по умолчанию 20). Неверные значения читаются как значения по умолчанию. Общий для всех участников, входит в снимки (`test_cvs06_board_settings_root_survives_compaction_and_restart`).
- Миникарта (T5.1, CVS-04) читает `objects` через `sceneRects` = `readScene` → объекты верхнего уровня (рамка группы — по её объектам, без поворота). Комментарии — T6.10, таймер и голосование — T8.1, заметки — T6.12.
- Корзина (T4.3, основа COL-08): `moveToTrash(board, ids, deletedBy)` одной транзакцией Yjs для каждого известного id кладёт в `trash[id]` `Y.Map { object: копия объекта (вложенный общий тип — `clone()`), deletedAt: ISO 8601, deletedBy: имя }` и удаляет ключ из `objects`; неизвестные id пропускаются. Восстановления из корзины пока нет (T8.2). Жизненный цикл — [states/board-object.md](states/board-object.md).
- Отложенные обновления (T6.2, BUG-018): обновление, пришедшее раньше той правки, от которой оно зависит, `pycrdt` держит отложенным — в `get_update()` и снимок оно не входит. `BoardRoom._journal` хранит строки журнала (`StoredUpdate(seq, update)`), ещё не отрезанные сжатием; `compact` оставляет в `board_updates` те из них, где есть структуры, которых нет в документе (`_has_unapplied`: разница обновления и вектора версии не пуста), и не пишет снимок, если отрезать нечего. Когда недостающая правка доезжает, следующее сжатие отрезает и их.
- Сервер не разбирает объекты, но подписан на корень `trash` своей копии (`_on_trash_change`): ключи с действием `add`/`update` в принятом обновлении (`_integrate`) попадают в `JournalEntry.trashed`, и `store.append` пишет запись `board_events` `objects_deleted` с именем из сессии соединения ([data-model.md](data-model.md)). Подписка ставится после загрузки, поэтому состояние из снимка/журнала записей не порождает.
- Комментарии (T6.10, CMT-01…CMT-04): корень `comments` — `Y.Map` id ветки (как id объекта, 32 hex) → `CommentThreadMap`. Ветка пишется одной транзакцией вместе с первым сообщением (`createThread`); пустых веток в документе нет. `anchor` — запись-JSON: у объекта — `{object, u, v}`, доли ширины и высоты его рамки в системе объекта без поворота (`anchorAt`, зажаты в 0…1), у точки доски — `{object: null, x, y}`. Точку метки считает `pinPoint` по текущей рамке объекта из `readScene` (с поворотом), поэтому метка едет, тянется и поворачивается вместе с объектом; объекта нет среди видимых (корзина, скрытое содержимое фрейма) — метки нет, ветка остаётся. `messages` — `Y.Array` записей-JSON `{id, author, text, at}`, ответы дописываются в конец (`addReply`), правки и удаления сообщений нет. `resolved` и `color` (палитра `COMMENT_COLORS`) — поля ветки, их меняют `setResolved`, `setThreadColor`. `readThreads` пропускает записи с неверной привязкой или без `messages`, сообщения неверного вида и сортирует ветки по `createdAt`, затем по id. Фильтр по участникам (`participants`, `filterThreads`) — авторы сообщений, объединение выбранных. Непрочитанные (CMT-02) в документ не входят: `localStorage` `myboard.commentReads.<boardId>.<имя>` — id прочитанных сообщений (не больше 2000), свои сообщения прочитаны всегда; цвет следующей ветки — `localStorage` `myboard.commentColor`.
- Заметка доски (T6.12, NTE-01…NTE-03): корень `notes` — `Y.XmlFragment`; пока заметку не начинали, он пуст. Заметка — один `Y.XmlText` в корне (`NoteText`): текст в той же модели, что у документа (`RichTextContent`: атрибуты Quill, вставки `{ divider: true }` и `{ objectLink: id }`), флаг закрепления — атрибут `openForAll` (`true` — заметка открыта у каждого входящего, NTE-02; `isNoteOpenForAll`, `setNoteOpenForAll`). Узел создаётся при первой правке или закреплении (`ensureNoteText`) детерминированно (BUG-027, COL-01): `createNoteUpdate` один раз собирает обновление в служебном `Y.Doc` с `clientID = 0` (`NOTE_CLIENT_ID`) — вставка пустого `Y.XmlText` в `notes`, — и каждый клиент применяет к своему документу это же обновление (`Y.applyUpdate`). У всех участников оно побайтно одинаковое, поэтому одновременное начало заметки (в сети или без связи) даёт один узел с id `0:0`, и правки всех пишутся в один текст. Чтение (`noteText`): из `Y.XmlText` корня берётся узел с `client = 0` (`isCanonical`), иначе первый — так читается и правится заметка прежнего формата, созданная до BUG-027 узлом со случайным id клиента. Показ — `noteOps` (`toDelta()`), отметка пункта списка дел без правки — `checkNoteItem` (`format(end, 1, {list})`). Правка (`RichTextEditor` с `type: note`) идёт через `bindQuill` в тот же `Y.XmlText` (наследник `Y.Text`), origin `null`. Сервер заметку не разбирает.
- Интерфейс пишет в `objects`, `settings`, `trash`, `comments` и `notes` (заметка доски): создание, правки, группы, порядок слоёв, блокировку, вставку и удаление (`moveToTrash` с именем своего участника, CVS-21; вместе с выбранным — вложенные объекты и опустевшие группы, `removalSet`) — [states/board-object.md](states/board-object.md). Выделение, инструмент, черновик рамки/лассо и меню — состояние вкладки, в документ не входят. Документ создаётся заново на каждую открытую доску (`useBoardConnection`) и наполняется из `STEP2` сервера.
- Отмена и повтор (T5.4, CVS-07): `UndoHistory` (`scene/undoHistory.ts`) держит `Y.UndoManager` над корнями `objects`, `trash` и `settings` и записывает только локальные транзакции (origin `null`); обновления других участников он не отменяет. Корни `comments` (T6.10) и `notes` (T6.12) в область отмены не входят: у заметки внутри поля работает отмена Quill. Отмена — обычная транзакция Yjs: структура документа и поля объектов не меняются, новых корней нет. Стек отмены в документ, снимки и резервные копии не входит.
- Присутствие (курсоры, вид камеры, слежение, список участников — T4.2; след лазерной указки — T6.5, DRW-05) в документ не входит; запомненный вид камеры (CVS-05) хранится в `localStorage` браузера, а не в документе: оно идёт сообщениями `awareness`/`presence` и живёт только в памяти соединений ([ws-protocol.md](ws-protocol.md)).
- Серверная копия собирается из последнего снимка `board_snapshots` и хвоста `board_updates` при первом подключении к доске (`Hub.join` → `store.load_journal` → `BoardRoom(board_id, journal)`) и выгружается, когда уходит последнее соединение (`Hub.leave`, с этим — сжатие журнала). Снимок — полное состояние `Doc.get_update()`; присутствия в нём нет. См. [data-model.md](data-model.md), [sequences/sync.md](sequences/sync.md).

Актуально на: T6.12, ab26d38 (заметка доски: корень `notes` — один `NoteText` (`Y.XmlText`) с текстом в модели `RichTextContent` и атрибутом `openForAll`, узел `0:0` от служебного клиента `NOTE_CLIENT_ID = 0` — BUG-027, чтение прежнего узла со случайным id, `noteData.ts`; T6.11, 7261d39 — реакции, флип-карточки, кубик: `type: reaction` — дочерний объект с `parent`, `image`, `ReactionShape`, `reactionData.ts`, `reactions.ts`, выбор и недавние в `localStorage` `myboard.reactions` (`reactionChoice.ts`); `type: flipcard` — `backText`, `flipped`, `direction`, поля сторон `FlipSideFields`, картинка data URL (Q-006), `FlipShape`, `flipData.ts`, `flipCards.ts`, `imageFile.ts`; `type: dice` — `faces`, `value`, `roll`, `DiceShape`, `diceData.ts`, `dice.ts`; `SceneObject.reaction`, `flip`, `dice`; T6.10, 003afc0 — комментарии: `comments` с `CommentThreadMap`, `CommentAnchor`, `CommentMessage`, `commentData.ts`, `commentReads.ts`, непрочитанные вне документа; T6.9, 211b781 — интеллект-карта: `type: mindmap`, `root`, `nodes` с `MindmapNodeMap`, `mindmapData.ts`, `mindmaps.ts`, `SceneObject.mindmap`, `NodeDrop`; T6.8, ad223be — канбан и карточка: `type: kanban`, `columns`, `titles`, `type: card`, карточка в столбце — `parent` и `cell`, `kanbanData.ts`, `kanbans.ts`, `SceneObject.kanban`, `slotRect`, `ColumnFate`; T6.7, 88f9e7e — таблица: `type: table`, `columns`, `rows`, `sizes`, `cells` с `TableCellMap`, поле `cell` объекта в ячейке, `tableData.ts`, `tables.ts`, `tableExchange.ts`, `SceneObject.table`, `cell`, `containerUnder`, `Container`, копия таблицы; T6.6, e94fd44 — фрейм: `type: frame`, `appearance`, `keepRatio`, `contentHidden`, `lockContent`, дети с `parent` = фрейм, `frameOptions.ts`, `frames.ts`, `SceneObject.frameOptions`, `hidden`; T6.5, d31412e — рисунок: `type: drawing`, `points`, `baseWidth`, `baseHeight`, `brush`, `drawingShape.ts`, `drawEdits.ts`, категория недавних цветов `drawing`, ластик — в корзину, лазер вне документа; T6.4, e2e079f — линия: `type: line`, `start`, `end`, `points`, `lineStyle`, `startCap`, `endCap`, `labels`, привязка концов, `connectors.ts`, `lineEdits.ts`, копирование линий; T6.3, 0de9f87 — фигура: `shape`, `marker`, `strokeWidth`, `radius`, прозрачная заливка, размер вида в `createObject`, каталог `shapes.ts`, `styleOptions.ts`, недавние цвета вне документа; стикер — T6.2, ce46d3f: стикер с `Y.Text` с атрибутами, `fontSize: auto`, `showAuthor`, теги `Y.Array`, тип `stack`, отложенные обновления в журнале сервера — BUG-018; тип `document` — T6.1, 986b7b2; поле `tags`, поиск — T5.5, 044e3c2; область отмены — T5.4, e2d1150; `topZ` с записями-JSON — T5.6, 298b639, BUG-008; поля объектов — T5.3, 1c15594). Требования: NTE-01…NTE-03 (заметка доски, закрепление `openForAll`, ссылки на объекты `objectLink`), RCT-01…RCT-04 (реакция на объекте, автор, размер удержанием; наборы и недавние — вне документа), FLP-01…FLP-03 (флип-карточка, стороны, картинка, направление, переворот, оформление сторон), DICE-01…DICE-03 (кубик, грани, цвет, бросок; сумма — вне документа), CMT-01…CMT-04 (ветки у объекта или точки, ответы, «решено», цвет, фильтр по участникам; непрочитанные — вне документа), MAP-01…MAP-04 (интеллект-карта, узлы, сворачивание веток, перекраска с потомками), KBN-01…KBN-03 (канбан, карточки в столбцах, правка столбцов), TBL-01…TBL-07 (таблица, ячейки, объединение, объекты в ячейках, обмен с электронными таблицами), FRM-01…FRM-05 (фрейм, его дети, оформление, пропорции, скрытие и блокировка содержимого), DRW-01…DRW-04, DRW-06 (рисунок, его запись, стирание и масштаб), DRW-05 (вне документа), CON-01…CON-07, CVS-26 (соединительные линии, подписи, привязка), SHP-01…SHP-04 (фигуры, BPMN, оформление фигуры, свой цвет), STK-01…STK-05 (стикер, теги, автор, стопка), CVS-06 (`settings`), CVS-07 (область отмены), CVS-09…CVS-14, CVS-21 (объекты сцены, их запись и удаление), CVS-15…CVS-20, CVS-22 (группы, слои, блокировка, буфер обмена, автор и даты), CVS-08 (`tags`, чтение поиском), TXT-01…TXT-08 (текст и документ, форматирование, буфер обмена), COL-01, COL-07 и COL-08 (основа: снимки, корзина), CVS-04 (чтение `objects` миникартой), COL-02…COL-04, COL-09, CVS-05 (вне документа); ARCHITECTURE.md, раздел 6 (структура документа, корзина).
