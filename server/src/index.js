import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDatabase } from './db.js';
import { createSyncStore, SyncError } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(here, '../../data'));
const CLIENT_DIST = path.resolve(process.env.CLIENT_DIST ?? path.join(here, '../../client/dist'));

fs.mkdirSync(DATA_DIR, { recursive: true });
const { db } = openDatabase(path.join(DATA_DIR, 'almanac.sqlite3'));
const store = createSyncStore(db);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// The Android app's pages come from inside the app (https://localhost), not from this server,
// so the API lets that origin in. Other sites still can't read it.
const APP_ORIGINS = new Set((process.env.ALMANAC_APP_ORIGINS ?? 'https://localhost').split(',').filter(Boolean));
app.use('/api', (req, res, next) => {
  const { origin } = req.headers;
  if (origin && APP_ORIGINS.has(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
  }
  res.vary('Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/sync', (req, res) => {
  try {
    res.json(store.sync(req.body ?? {}));
  } catch (err) {
    if (err instanceof SyncError) return res.status(400).json({ error: err.message });
    console.error('sync failed', err);
    res.status(500).json({ error: 'sync failed' });
  }
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: 'index.html' }));
} else {
  console.warn(`No client build at ${CLIENT_DIST}; serving the API only.`);
}

app.listen(PORT, HOST, () => {
  console.log(`Almanac listening on http://${HOST}:${PORT} (data in ${DATA_DIR})`);
});
