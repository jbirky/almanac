import * as Y from 'yjs';
import { SCHEMA_SQL, SCHEMA_VERSION, isSyncedCell } from './schema.js';
import { createClock, hlcNode, isHlc } from './hlc.js';
import { fromBase64, randomHex } from './util.js';
import { fileIdsInDoc, ydocText } from './body.js';

// The last of `rows` (in order, each with a `size`) that fits in `maxBytes` all together; the
// first one even if it alone is larger. Undefined if there are none.
export function upToBytes(rows, maxBytes) {
  let total = 0;
  let last;
  for (const row of rows) {
    total += row.size;
    if (last && total > maxBytes) break;
    last = row;
  }
  return last;
}

// The local-first store: every write becomes a change message
// { hlc, tbl, row, col, value } that is applied locally and queued in the outbox;
// changes received from other devices go through the same merge. `value` is JSON text,
// except for bodies.ydoc, where it is a JSON string holding a base64 Yjs update.
export function createCore(db, { now = Date.now } = {}) {
  db.exec(SCHEMA_SQL);

  const getMeta = (key) => db.get('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  const setMeta = (key, value) =>
    db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );

  let node = getMeta('node');
  let upgradedFrom = null;
  if (!node) {
    node = randomHex(8);
    setMeta('node', node);
    setMeta('schema_version', String(SCHEMA_VERSION));
  } else {
    const stored = Number(getMeta('schema_version') ?? 1);
    if (stored < SCHEMA_VERSION) {
      // The old schema skipped changes to cells it didn't know; pull the whole log again.
      // Re-applying known changes is a no-op (same timestamps; Yjs updates are idempotent).
      setMeta('cursor', '0');
      setMeta('schema_version', String(SCHEMA_VERSION));
      upgradedFrom = stored;
    }
  }
  const clock = createClock(node, getMeta('clock'), now);
  const listeners = new Set();

  // What the current write touched: reported to listeners and used to refresh search.
  let touched = null;

  function write(fn) {
    if (touched) return fn();
    touched = { tables: new Set(), rows: new Set(), searchRows: new Set() };
    try {
      const result = db.transaction(() => {
        const r = fn();
        refreshSearch(touched.searchRows);
        setMeta('clock', clock.current());
        return r;
      });
      const change = { tables: [...touched.tables], rows: [...touched.rows] };
      touched = null;
      if (change.tables.length) for (const listener of listeners) listener(change);
      return result;
    } catch (err) {
      touched = null;
      throw err;
    }
  }

  function touch(tbl, row, col) {
    touched.tables.add(tbl);
    touched.rows.add(row);
    if (tbl === 'bodies' || (tbl === 'items' && ['title', 'deleted'].includes(col))) touched.searchRows.add(row);
  }

  const getClock = (tbl, row, col) =>
    db.get('SELECT hlc FROM clock WHERE tbl = ? AND row = ? AND col = ?', [tbl, row, col])?.hlc ?? null;
  const setClock = (tbl, row, col, hlc) =>
    db.run(
      'INSERT INTO clock (tbl, row, col, hlc) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, row, col) DO UPDATE SET hlc = excluded.hlc',
      [tbl, row, col, hlc],
    );

  // Merge one change into the local tables. Returns true if it changed anything.
  function applyMessage({ hlc, tbl, row, col, value }) {
    if (!isSyncedCell(tbl, col) || typeof row !== 'string') return false;
    if (tbl === 'bodies') return mergeBody(hlc, row, value);

    const current = getClock(tbl, row, col);
    if (current && current >= hlc) return false; // we already have this change or a newer one

    let v;
    try {
      v = value == null ? null : JSON.parse(value);
    } catch {
      return false;
    }
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v !== null && typeof v === 'object') v = JSON.stringify(v);
    if (col === 'deleted') v = v ? 1 : 0;

    // Column names come from the TABLES allowlist (checked above), never from the message.
    db.run(
      `INSERT INTO ${tbl} (id, ${col}) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ${col} = excluded.${col}`,
      [row, v],
    );
    setClock(tbl, row, col, hlc);
    touch(tbl, row, col);
    return true;
  }

  // Yjs updates commute and are idempotent, so every update is applied; no timestamp check.
  function mergeBody(hlc, row, value) {
    const doc = new Y.Doc();
    try {
      const update = fromBase64(JSON.parse(value));
      const current = db.get('SELECT ydoc FROM bodies WHERE id = ?', [row]);
      if (current?.ydoc) Y.applyUpdate(doc, current.ydoc);
      Y.applyUpdate(doc, update);
      db.run(
        'INSERT INTO bodies (id, ydoc, text) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ydoc = excluded.ydoc, text = excluded.text',
        [row, Y.encodeStateAsUpdate(doc), ydocText(doc)],
      );
    } catch {
      return false;
    } finally {
      doc.destroy();
    }
    // Recorded only so "last edited" can be read from the clock table.
    const current = getClock('bodies', row, 'ydoc');
    if (!current || current < hlc) setClock('bodies', row, 'ydoc', hlc);
    touch('bodies', row, 'ydoc');
    return true;
  }

  function refreshSearch(ids) {
    for (const id of ids) {
      db.run('DELETE FROM search WHERE id = ?', [id]);
      db.run(
        `INSERT INTO search (id, title, body)
         SELECT i.id, IFNULL(i.title, ''), IFNULL(b.text, '')
         FROM items i LEFT JOIN bodies b ON b.id = i.id
         WHERE i.id = ? AND i.deleted = 0`,
        [id],
      );
    }
  }

  // Local writes: [{ tbl, row, col, value }] with plain JS values.
  function mutate(changes) {
    return write(() =>
      changes.map(({ tbl, row, col, value }) => {
        if (!isSyncedCell(tbl, col)) throw new Error(`Unknown cell ${tbl}.${col}`);
        const msg = { hlc: clock.send(), tbl, row, col, value: JSON.stringify(value ?? null) };
        applyMessage(msg);
        db.run('INSERT INTO outbox (hlc, tbl, row, col, value) VALUES (?, ?, ?, ?, ?)', [
          msg.hlc,
          tbl,
          row,
          col,
          msg.value,
        ]);
        return msg;
      }),
    );
  }

  // Changes from the server. Our own changes come back too; they are already applied.
  function receive(messages) {
    return write(() => {
      let applied = 0;
      let shown = null;
      for (const msg of messages) {
        if (!isHlc(msg.hlc) || hlcNode(msg.hlc) === node) continue;
        clock.recv(msg.hlc);
        // The server removes an image file once no note has shown it for a while. If a note
        // here shows it again (one written offline, say), its bytes are written again instead,
        // after the removal, so they win.
        if (msg.tbl === 'files' && msg.col === 'data' && (msg.value == null || msg.value === 'null')) {
          const kept = db.get('SELECT data FROM files WHERE id = ?', [msg.row])?.data;
          if (kept && (shown ??= filesShown()).has(msg.row)) {
            mutate([{ tbl: 'files', row: msg.row, col: 'data', value: kept }]);
            continue;
          }
        }
        if (applyMessage(msg)) applied++;
      }
      return applied;
    });
  }

  // Ids of the image files any note here shows.
  function filesShown() {
    const ids = new Set();
    for (const { ydoc } of db.all('SELECT ydoc FROM bodies WHERE ydoc IS NOT NULL')) {
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, ydoc);
        for (const id of fileIdsInDoc(doc)) ids.add(id);
      } catch {
        // A body that can't be read shows nothing.
      } finally {
        doc.destroy();
      }
    }
    return ids;
  }

  return {
    db,
    node,
    upgradedFrom,
    write,
    mutate,
    receive,
    filesShown,
    getMeta,
    setMeta,
    // The oldest changes waiting to go out, up to `limit` of them and about `maxBytes` of
    // values (at least one change, however large: an image can be megabytes).
    outbox(limit = 1000, maxBytes = Infinity) {
      const sizes = db.all('SELECT id, IFNULL(length(value), 0) AS size FROM outbox ORDER BY id LIMIT ?', [limit]);
      const last = upToBytes(sizes, maxBytes);
      if (!last) return [];
      return db.all('SELECT id, hlc, tbl, row, col, value FROM outbox WHERE id <= ? ORDER BY id', [last.id]);
    },
    outboxCount: () => db.get('SELECT COUNT(*) AS n FROM outbox').n,
    ackOutbox: (maxId) => db.run('DELETE FROM outbox WHERE id <= ?', [maxId]),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
