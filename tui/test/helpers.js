import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as Y from 'yjs';
import { BODY_FIELD, NOTE_BOX, adaptBetterSqlite, createActions, createCore, createQueries, createSyncer } from '@almanac/shared';
import { createSyncStore } from '../../server/src/store.js';
import { locations } from '../src/config.js';

// Where a test's copy, lock, socket and settings go: a directory of its own, removed by `done`.
export function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-tui-'));
  const env = { XDG_DATA_HOME: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config') };
  return { ...locations(env), env, root: dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// The server's sync store, in memory.
export const makeServer = () => createSyncStore(adaptBetterSqlite(new Database(':memory:')));

// A fetch that answers /api/sync from `server`, round-tripping JSON as the HTTP endpoint does.
export const fetchFrom = (server) => async (url, init) => {
  const body = JSON.stringify(server.sync(JSON.parse(init.body)));
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

// The server over HTTP, for the shell commands: { url, server, close }.
export async function serveHttp(server = makeServer()) {
  const httpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true }));
      if (req.url === '/api/sync' && req.method === 'POST') return res.end(JSON.stringify(server.sync(JSON.parse(body))));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${httpServer.address().port}`,
    server,
    close: () => new Promise((resolve) => httpServer.close(resolve)),
  };
}

// Another device on the same server, such as a browser, in memory.
export function makeDevice(server) {
  const db = adaptBetterSqlite(new Database(':memory:'));
  const core = createCore(db);
  const syncer = createSyncer(core, async (payload) => JSON.parse(JSON.stringify(server.sync(JSON.parse(JSON.stringify(payload))))));
  return { core, actions: createActions(core), queries: createQueries(db), sync: () => syncer.sync() };
}

// Writes a journal day with `act` (a replica's act, or a device's actions as a function), as
// the web editor stores it. `build` gets the body and helpers for its blocks.
export function writeDay(act, date, build) {
  const id = act('ensureJournal', date);
  const doc = new Y.Doc();
  const body = doc.getXmlFragment(BODY_FIELD);
  build(body, blocks);
  act('applyBodyUpdate', id, Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return id;
}

export const blocks = {
  // A paragraph of strings, { text, marks } and { math } parts.
  para(parent, ...parts) {
    const p = new Y.XmlElement('paragraph');
    parent.push([p]);
    p.insert(
      0,
      parts.map((part) => {
        if (typeof part === 'string') return new Y.XmlText(part);
        if (part.math !== undefined) {
          const m = new Y.XmlElement('inlineMath');
          m.setAttribute('latex', part.math);
          return m;
        }
        const t = new Y.XmlText();
        t.insert(0, part.text, part.marks);
        return t;
      }),
    );
    return p;
  },
  task(parent, id) {
    const t = new Y.XmlElement('taskRef');
    t.setAttribute('id', id);
    parent.push([t]);
  },
  box(parent, id, label, fill) {
    const b = new Y.XmlElement(NOTE_BOX);
    if (id) b.setAttribute('id', id);
    if (label) b.setAttribute('label', label);
    parent.push([b]);
    fill?.(b);
    return b;
  },
  element(parent, name, attributes = {}, fill) {
    const e = new Y.XmlElement(name);
    for (const [k, v] of Object.entries(attributes)) e.setAttribute(k, v);
    parent.push([e]);
    fill?.(e);
    return e;
  },
};

// A terminal for Ink to draw into: `columns` × `rows`, keeping the last frame.
export class FakeStdout extends EventEmitter {
  constructor(columns = 120, rows = 36) {
    super();
    this.columns = columns;
    this.rows = rows;
    this.isTTY = true;
    this.frames = [];
  }
  write(frame) {
    this.frames.push(frame);
    return true;
  }
  lastFrame() {
    return this.frames.at(-1) ?? '';
  }
}

// Keys for Ink to read, as ink-testing-library's stdin sends them.
export class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.data = null;
  }
  write(data) {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  }
  read() {
    const { data } = this;
    this.data = null;
    return data;
  }
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  shiftTab: '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  home: '\x1b[H',
  end: '\x1b[F',
  altUp: '\x1b[1;3A',
  altDown: '\x1b[1;3B',
};
