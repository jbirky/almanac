// Owns the local SQLite database. The UI calls queries and actions over postMessage;
// the worker pushes { type: 'changed' } after every write and { type: 'status' } as sync runs.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createActions, createAdapter, createCore, createQueries, createSyncer } from '@almanac/shared';

const SYNC_DELAY_MS = 800;
const SYNC_INTERVAL_MS = 15_000;

const status = { storage: null, online: navigator.onLine, syncing: false, pending: 0, lastSync: null, error: null };
let core, actions, queries, syncer;
// The server's address; '' for the one the page came from. It comes as the worker's name, and
// in a message when Settings changes it.
let server = self.name;

function setStatus(patch) {
  Object.assign(status, patch);
  postMessage({ type: 'status', status: { ...status } });
}

async function open() {
  const sqlite3 = await sqlite3InitModule();
  let raw;
  try {
    // The SAH-pool backend persists to the origin private file system and, unlike the
    // plain OPFS backend, needs no cross-origin isolation headers. It allows one tab at a time.
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'almanac' });
    raw = new pool.OpfsSAHPoolDb('/almanac.sqlite3');
    setStatus({ storage: 'persistent' });
  } catch (err) {
    console.warn('Browser file storage unavailable; keeping data in memory until it syncs.', err);
    raw = new sqlite3.oo1.DB(':memory:');
    setStatus({ storage: 'memory' });
  }

  const db = createAdapter({
    exec: (sql) => raw.exec(sql),
    run: (sql, bind) => raw.exec({ sql, bind: bind.length ? bind : undefined }),
    all: (sql, bind) =>
      raw.exec({ sql, bind: bind.length ? bind : undefined, rowMode: 'object', returnValue: 'resultRows' }),
  });
  core = createCore(db);
  actions = createActions(core);
  queries = createQueries(db);
  syncer = createSyncer(core, send);
  core.subscribe((change) => postMessage({ type: 'changed', ...change }));
  actions.foldScheduledIntoDue();
  setStatus({ pending: core.outboxCount() });
}

async function send(payload) {
  const res = await fetch(`${server}/api/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  return res.json();
}

let timer = null;
function scheduleSync(delay = SYNC_DELAY_MS) {
  clearTimeout(timer);
  timer = setTimeout(runSync, delay);
}

async function runSync() {
  clearTimeout(timer);
  setStatus({ syncing: true });
  try {
    await syncer.sync();
    // Tasks from a device still on the old version may arrive with a scheduled date.
    if (actions.foldScheduledIntoDue()) scheduleSync();
    setStatus({ syncing: false, online: true, error: null, lastSync: new Date().toISOString() });
  } catch (err) {
    // fetch rejects with a TypeError when the server cannot be reached at all.
    const offline = err instanceof TypeError;
    setStatus({ syncing: false, online: !offline && navigator.onLine, error: offline ? null : err.message });
  } finally {
    setStatus({ pending: core.outboxCount() });
  }
}

const ready = open().then(() => {
  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
  self.addEventListener('online', runSync);
  self.addEventListener('offline', () => setStatus({ online: false }));
});

self.onmessage = async ({ data }) => {
  const { id, kind, name, args = [] } = data;
  if (kind === 'config') {
    // A new address: sync with it now.
    const changed = server !== data.serverUrl;
    server = data.serverUrl;
    if (changed) ready.then(runSync);
    return;
  }
  try {
    await ready;
    let result;
    if (kind === 'query' && Object.hasOwn(queries, name)) {
      result = queries[name](...args);
    } else if (kind === 'action' && Object.hasOwn(actions, name)) {
      result = actions[name](...args);
      setStatus({ pending: core.outboxCount() });
      scheduleSync();
    } else if (kind === 'sync') {
      await runSync();
    } else if (kind === 'status') {
      result = { ...status };
    } else {
      throw new Error(`Unknown call ${kind} ${name}`);
    }
    postMessage({ id, result });
  } catch (err) {
    postMessage({ id, error: err?.message ?? String(err) });
  }
};
