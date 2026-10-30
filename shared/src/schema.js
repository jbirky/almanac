// Synced tables. Every table has `id TEXT PRIMARY KEY`; every column listed here is a
// separate merge cell (latest hybrid-logical-clock timestamp wins), except bodies.ydoc,
// which holds a Yjs document that merges updates instead.
// Left over from the earlier version and no longer used by the app, but kept so their
// changes still sync and replay: items.scheduled (folded into due), views and types.
// props holds a task's category (key 'category') and its place among that category's tasks in
// the list (key 'position': a number), a label's color (key 'color': a palette name, or
// "#rrggbb" for one picked by hand), and the task list's order of categories (row
// 'settings/categoryOrder': a list of names). On a journal day, key 'pin' (row
// '<day id>/pin/<box id>') pins one of its notes boxes to the days after it: { box, until },
// until being the day it was unpinned from, or null. Older props such as tags are ignored. Labels for
// notes boxes are items of type 'label'. A subtask is a task with a 'subtask' link from its
// parent task. files holds the images in notes, each written once and never changed: its
// type ("image/png") and its bytes in base64; a body's image nodes name them by id. The server
// sets the bytes of one no note has shown for 30 days to null (server/src/store.js). calendars
// and events are written only by the server, from the calendar feeds it reads
// (server/src/calendars.js): a calendar's name and how reading it last went, and an event (per
// UID) as shared/src/calendar.js describes it.
export const TABLES = {
  items: ['type', 'title', 'status', 'scheduled', 'due', 'done_at', 'created_at', 'deleted'],
  props: ['item_id', 'key', 'value', 'deleted'],
  links: ['from_id', 'to_id', 'kind', 'deleted'],
  task_events: ['item_id', 'event', 'at'],
  views: ['name', 'query', 'position', 'deleted'],
  bodies: ['ydoc'], // id = the item's id
  types: ['name', 'fields', 'template', 'deleted'], // id = a built-in type it overrides, or a new id
  files: ['type', 'data'],
  calendars: ['name', 'error', 'checked_at', 'deleted'],
  events: ['calendar', 'data', 'deleted'],
};

export function isSyncedCell(tbl, col) {
  return Object.hasOwn(TABLES, tbl) && TABLES[tbl].includes(col);
}

// Bump when TABLES gains a table or column. Devices on an older version ignored changes to
// cells they didn't know, so an upgraded device pulls the whole change log again.
export const SCHEMA_VERSION = 4;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT,
  title TEXT,
  status TEXT,          -- tasks: open | done | dropped
  scheduled TEXT,       -- unused; see foldScheduledIntoDue
  due TEXT,             -- local date YYYY-MM-DD
  done_at TEXT,         -- ISO timestamp, UTC
  created_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_type_status ON items (type, status);
CREATE INDEX IF NOT EXISTS items_done_at ON items (done_at);

CREATE TABLE IF NOT EXISTS props (
  id TEXT PRIMARY KEY,  -- item_id/key
  item_id TEXT,
  key TEXT,
  value TEXT,           -- JSON
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS props_item ON props (item_id);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  from_id TEXT,
  to_id TEXT,
  kind TEXT,            -- belongs_to | embed | ref | label | subtask
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS links_from ON links (from_id);
CREATE INDEX IF NOT EXISTS links_to ON links (to_id);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  event TEXT,           -- created | done | reopened | dropped
  at TEXT
);
CREATE INDEX IF NOT EXISTS task_events_item ON task_events (item_id);

CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY,
  name TEXT,
  query TEXT,           -- JSON
  position REAL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS types (
  id TEXT PRIMARY KEY,
  name TEXT,
  fields TEXT,          -- JSON: [{ key, label, kind, options? }]
  template TEXT,        -- JSON: TipTap document content
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  type TEXT,            -- MIME type, such as image/webp
  data TEXT             -- the bytes, in base64
);

CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,  -- cal-<a hash of its link>
  name TEXT,
  error TEXT,           -- why it couldn't be read the last time, or null
  checked_at TEXT,      -- ISO timestamp, UTC: when the server last read it
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,  -- <calendar id>/<the event's UID>
  calendar TEXT,
  data TEXT,            -- JSON: the event, as shared/src/calendar.js describes it
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_calendar ON events (calendar);

CREATE TABLE IF NOT EXISTS bodies (
  id TEXT PRIMARY KEY,
  ydoc BLOB,            -- Yjs document state
  text TEXT             -- plain text derived from ydoc, for search
);

-- Local bookkeeping, never synced.
CREATE TABLE IF NOT EXISTS clock (
  tbl TEXT NOT NULL,
  row TEXT NOT NULL,
  col TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (tbl, row, col)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS clock_row ON clock (row);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  hlc TEXT NOT NULL,
  tbl TEXT NOT NULL,
  row TEXT NOT NULL,
  col TEXT NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, title, body);
`;
