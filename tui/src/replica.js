import fs from 'node:fs';
import Database from 'better-sqlite3';
import { TABLES, adaptBetterSqlite, createActions, createCore, createQueries, createSyncer } from '@almanac/shared';
import { createBodies } from './journal/bodies.js';

const SYNC_DELAY_MS = 800;
const SYNC_INTERVAL_MS = 15_000;
// How often a read-only copy looks for writes by the process that holds the lock, and tries to
// take the lock itself.
const POLL_MS = 1000;
const ALL_TABLES = Object.keys(TABLES);

export class ReadOnlyError extends Error {
  constructor() {
    super('Almanac is open in another terminal, so this one can only read.');
  }
}

// The lock on a copy: an exclusive lock on a small SQLite file next to it. The system lets go of
// it when the process ends, however it ends. Returns the lock's handle (close it to let go), or
// null if another process holds it.
//
// One process writes to a copy at a time because the clock that stamps changes lives in the
// process's memory: two processes on one copy would share a node id and could give two changes
// the same timestamp, and other devices would then keep whichever reached them first.
export function takeLock(file) {
  const db = new Database(file, { timeout: 0 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE; COMMIT');
    return db;
  } catch (err) {
    db.close();
    if (err.code === 'SQLITE_BUSY') return null;
    throw err;
  }
}

// This machine's copy of everything, as the browser's database worker keeps one: it applies
// writes at once, and syncs them out 800 ms after a write, every 15 s, and on request. Without
// the lock (another process holds it) the copy opens read-only, shows what that process
// writes, and takes over once the lock is free; with `requireLock`, it isn't opened at all and
// this returns null. `server` is the address to sync with.
export function openReplica({ paths, server, fetch = globalThis.fetch, requireLock = false }) {
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  let lock = takeLock(paths.lock);
  if (!lock && requireLock) return null;
  const changeListeners = new Set();
  const statusListeners = new Set();
  let status = { readOnly: false, online: true, syncing: false, pending: 0, lastSync: null, error: null, reason: null };
  let raw, core, actions, queries, syncer;
  let syncTimer = null;
  let interval = null;
  let poll = null;
  let started = false;
  let closed = false;
  let dataVersion = null;

  const setStatus = (patch) => {
    status = { ...status, ...patch };
    for (const listener of statusListeners) listener(status);
  };
  const emit = (change) => {
    for (const listener of changeListeners) listener(change);
  };

  function openWritable() {
    raw = new Database(paths.db);
    raw.pragma('journal_mode = WAL');
    raw.pragma('synchronous = NORMAL');
    const db = adaptBetterSqlite(raw);
    core = createCore(db);
    actions = createActions(core);
    queries = createQueries(db);
    syncer = createSyncer(core, send);
    core.subscribe(emit);
    actions.foldScheduledIntoDue();
    status = { ...status, readOnly: false, pending: core.outboxCount() };
  }

  function openReadOnly() {
    raw = new Database(paths.db, { readonly: true, fileMustExist: true });
    queries = createQueries(adaptBetterSqlite(raw));
    dataVersion = raw.pragma('data_version', { simple: true });
    status = { ...status, readOnly: true };
  }

  if (lock) {
    openWritable();
  } else {
    try {
      openReadOnly();
    } catch (err) {
      // The process with the lock is making the copy for the first time.
      if (err.code === 'SQLITE_CANTOPEN') throw new Error('Almanac is setting up its copy in another terminal. Try again in a moment.');
      throw err;
    }
  }

  async function send(payload) {
    const res = await fetch(`${server}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ? `Server answered ${res.status}: ${body.error}` : `Server answered ${res.status}`);
    }
    return res.json();
  }

  function scheduleSync(delay = SYNC_DELAY_MS) {
    if (!started || status.readOnly) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, delay);
  }

  // Resolves with the status once the sync is over, whether or not it went through.
  async function runSync() {
    clearTimeout(syncTimer);
    if (closed || status.readOnly) return status;
    if (!server) {
      setStatus({ online: false, reason: 'No server set' });
      return status;
    }
    setStatus({ syncing: true });
    try {
      await syncer.sync();
      if (closed) return status;
      // Tasks from a device still on the old version may arrive with a scheduled date.
      if (actions.foldScheduledIntoDue()) scheduleSync();
      setStatus({ syncing: false, online: true, error: null, reason: null, lastSync: new Date().toISOString() });
    } catch (err) {
      if (closed) return status;
      // fetch rejects with a TypeError when the server can't be reached at all.
      const offline = err instanceof TypeError || err?.name === 'TimeoutError';
      setStatus({
        syncing: false,
        online: !offline,
        error: offline ? null : err.message,
        reason: offline ? (err.cause?.code ?? err.cause?.message ?? err.message) : null,
      });
    } finally {
      if (!closed) setStatus({ pending: core.outboxCount() });
    }
    return status;
  }

  // Read-only: shows what the process with the lock writes, and takes the lock once it's free.
  function watch() {
    if (closed || !status.readOnly) return;
    const taken = takeLock(paths.lock);
    if (taken) {
      lock = taken;
      raw.close();
      openWritable();
      setStatus({});
      emit({ tables: ALL_TABLES, rows: [] });
      startSyncing();
      return;
    }
    const version = raw.pragma('data_version', { simple: true });
    if (version !== dataVersion) {
      dataVersion = version;
      emit({ tables: ALL_TABLES, rows: [] });
    }
  }

  function startSyncing() {
    runSync();
    interval = setInterval(runSync, SYNC_INTERVAL_MS);
  }

  const replica = {
    get queries() {
      return queries;
    },
    get status() {
      return status;
    },
    get node() {
      return core?.node ?? null;
    },
    // Runs one of the actions in shared/, then syncs it out shortly.
    act(name, ...args) {
      if (status.readOnly) throw new ReadOnlyError();
      const result = actions[name](...args);
      setStatus({ pending: core.outboxCount() });
      scheduleSync();
      return result;
    },
    sync: () => runSync(),
    // Syncs on its own from now on (the TUI; one-off commands sync once instead).
    start() {
      if (started) return;
      started = true;
      if (status.readOnly) poll = setInterval(watch, POLL_MS);
      else startSyncing();
    },
    subscribe(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    // A last sync on the way out, given at most `ms` to finish; the copy has every change either
    // way, and sends what's left next time.
    async finish(ms = 3000) {
      if (!status.readOnly && server && core.outboxCount() > 0) {
        await Promise.race([runSync(), new Promise((resolve) => setTimeout(resolve, ms).unref())]);
      }
      replica.close();
    },
    close() {
      if (closed) return;
      if (!status.readOnly) replica.bodies.flushAll();
      closed = true;
      clearTimeout(syncTimer);
      clearInterval(interval);
      clearInterval(poll);
      raw.close();
      lock?.close();
    },
  };
  // Journal bodies being edited, as live documents (see bodies.js).
  replica.bodies = createBodies(replica);
  return replica;
}
