import { createCore, isHlc, upToBytes } from '@almanac/shared';

const MAX_PULL = 2000;
// About how much a pull carries in values, so a batch of images comes over in several.
const MAX_PULL_BYTES = 16 * 1024 * 1024;
const MAX_FIELD = 256;
const MAX_VALUE = 8 * 1024 * 1024;
// How long an image file no note shows is kept before it's removed.
export const UNUSED_FILE_DAYS = 30;

// The server keeps every change in an append-only log numbered by `seq` and relays it
// to devices. It also merges each change into its own copy of the tables, using the
// same core as the clients, so later features (export, snapshots) can read current state.
export function createSyncStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      hlc TEXT NOT NULL UNIQUE,
      tbl TEXT NOT NULL,
      row TEXT NOT NULL,
      col TEXT NOT NULL,
      value TEXT,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- Image files no note shows, since when (ms). The server's own; not synced.
    CREATE TABLE IF NOT EXISTS unused_files (
      id TEXT PRIMARY KEY,
      since INTEGER NOT NULL
    );
  `);
  const core = createCore(db);
  if (core.upgradedFrom !== null) replayLog();

  // After a schema upgrade, merge the whole log into the server's copy again.
  function replayLog() {
    let seq = 0;
    for (;;) {
      const rows = db.all('SELECT seq, hlc, tbl, row, col, value FROM messages WHERE seq > ? ORDER BY seq LIMIT 5000', [seq]);
      if (!rows.length) return;
      core.receive(rows);
      seq = rows.at(-1).seq;
    }
  }

  function validate(msg) {
    return (
      msg &&
      isHlc(msg.hlc) &&
      [msg.tbl, msg.row, msg.col].every((f) => typeof f === 'string' && f.length > 0 && f.length <= MAX_FIELD) &&
      (msg.value === null || (typeof msg.value === 'string' && msg.value.length <= MAX_VALUE))
    );
  }

  // Store pushed changes (ignoring ones already stored), then return everything after `cursor`.
  function sync({ messages = [], cursor = 0 }) {
    if (!Array.isArray(messages)) throw new SyncError('messages must be an array');
    if (!Number.isInteger(cursor) || cursor < 0) throw new SyncError('cursor must be a non-negative integer');
    const bad = messages.findIndex((m) => !validate(m));
    if (bad !== -1) throw new SyncError(`invalid message at index ${bad}`);

    db.transaction(() => {
      const fresh = messages.filter(
        (m) =>
          db.run('INSERT OR IGNORE INTO messages (hlc, tbl, row, col, value) VALUES (?, ?, ?, ?, ?)', [
            m.hlc,
            m.tbl,
            m.row,
            m.col,
            m.value,
          ]).changes === 1,
      );
      core.receive(fresh);
    });

    // Sizes first, so only the values that go out are loaded into memory.
    const sizes = db.all('SELECT seq, IFNULL(length(value), 0) AS size FROM messages WHERE seq > ? ORDER BY seq LIMIT ?', [
      cursor,
      MAX_PULL + 1,
    ]);
    const last = upToBytes(sizes.slice(0, MAX_PULL), MAX_PULL_BYTES);
    const more = last !== undefined && last !== sizes.at(-1);
    const rows = last
      ? db.all('SELECT seq, hlc, tbl, row, col, value FROM messages WHERE seq > ? AND seq <= ? ORDER BY seq', [cursor, last.seq])
      : [];
    return {
      messages: rows.map(({ seq, ...m }) => m),
      cursor: rows.length ? rows.at(-1).seq : cursor,
      more,
    };
  }

  // Removes the image files no note has shown for `days`: their bytes are set to null, a change
  // every device pulls (one whose notes show the file again writes it back), and the change that
  // carried them leaves the log, so a device that hasn't pulled it yet never gets them. The wait
  // leaves time to undo a deletion, to paste an image that was cut, and for a device that was
  // offline to send its notes. Returns the ids removed.
  function removeUnusedFiles({ now = Date.now(), days = UNUSED_FILE_DAYS } = {}) {
    const shown = core.filesShown();
    return core.write(() => {
      // Kept up to date: a file shown again, or already removed, leaves the list.
      const since = new Map(db.all('SELECT id, since FROM unused_files').map((row) => [row.id, row.since]));
      const unused = db.all('SELECT id FROM files WHERE data IS NOT NULL').filter(({ id }) => !shown.has(id));
      db.run('DELETE FROM unused_files');
      for (const { id } of unused) db.run('INSERT INTO unused_files (id, since) VALUES (?, ?)', [id, since.get(id) ?? now]);
      const due = db
        .all('SELECT id FROM unused_files WHERE since <= ? ORDER BY id', [now - days * 24 * 60 * 60 * 1000])
        .map(({ id }) => id);
      for (const msg of writeOwn(due.map((id) => ({ tbl: 'files', row: id, col: 'data', value: null })))) {
        db.run('DELETE FROM unused_files WHERE id = ?', [msg.row]);
      }
      return due;
    });
  }

  // Changes the server makes itself (removing image files, reading calendars): merged into its
  // copy and added to the log, each in place of the earlier changes to its cell, which it
  // replaces on every device and which none needs any more. Returns the changes made.
  function writeOwn(changes) {
    return core.write(() => {
      const messages = core.mutate(changes);
      for (const msg of messages) {
        db.run('INSERT INTO messages (hlc, tbl, row, col, value) VALUES (?, ?, ?, ?, ?)', [msg.hlc, msg.tbl, msg.row, msg.col, msg.value]);
        db.run('DELETE FROM messages WHERE tbl = ? AND row = ? AND col = ? AND hlc < ?', [msg.tbl, msg.row, msg.col, msg.hlc]);
        db.run('DELETE FROM outbox WHERE hlc = ?', [msg.hlc]);
      }
      return messages;
    });
  }

  return { sync, core, removeUnusedFiles, writeOwn };
}

export class SyncError extends Error {}
