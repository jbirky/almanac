import { saveServerUrl, serverUrl } from './server.js';

// The UI's handle on the database worker: query.<name>(...) and action.<name>(...) return
// promises; onChange and onStatus subscribe to what the worker reports.
// The worker's name carries where to sync, which it reads as it starts.
const worker = new Worker(new URL('../worker/db.worker.js', import.meta.url), { type: 'module', name: serverUrl() });

let nextId = 1;
const pending = new Map();
const changeListeners = new Set();
const statusListeners = new Set();
let lastStatus = null;

worker.onmessage = ({ data }) => {
  if (data.type === 'changed') {
    for (const listener of changeListeners) listener(data);
  } else if (data.type === 'status') {
    lastStatus = data.status;
    for (const listener of statusListeners) listener(lastStatus);
  } else {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error));
    else call.resolve(data.result);
  }
};

function call(kind, name, args = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, kind, name, args });
  });
}

const proxy = (kind) => new Proxy({}, { get: (_, name) => (...args) => call(kind, name, args) });
export const query = proxy('query');
export const action = proxy('action');
export const syncNow = () => call('sync');

// Sync with another server from now on (the Android app's Settings).
export function setServer(url) {
  saveServerUrl(url);
  worker.postMessage({ kind: 'config', serverUrl: url });
}

// Pull right away when the app comes back into view, so edits made on another device show up.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
});
addEventListener('focus', () => syncNow());

export function onChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function onStatus(listener) {
  statusListeners.add(listener);
  if (lastStatus) listener(lastStatus);
  return () => statusListeners.delete(listener);
}
