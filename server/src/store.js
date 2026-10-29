import { createCore, isHlc, upToBytes } from '@almanac/shared';

const MAX_PULL = 2000;
// About how much a pull carries in values, so a batch of images comes over in several.
const MAX_PULL_BYTES = 16 * 1024 * 1024;
const MAX_FIELD = 256;
const MAX_VALUE = 8 * 1024 * 1024;

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

  return { sync, core };
}

export class SyncError extends Error {}
