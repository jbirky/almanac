import crypto from 'node:crypto';
import { FeedError, parseFeed } from '@almanac/shared';

// The calendars the server reads: ICS links, such as the one Proton Calendar gives a calendar
// shared with a link, set in ALMANAC_CALENDARS (separated by spaces, commas or new lines). It
// reads each one every few minutes and writes what changed into the change log, as it writes the
// removal of an image file no note shows: a row per calendar, with its name and how reading it
// last went, and a row per event (shared/src/calendar.js). So every device has the events, offline
// too, and the links, which let anyone who has one read the calendar, stay on the server.

export const REFRESH_MINUTES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const HEADERS = { 'User-Agent': 'Almanac (reading a calendar)', Accept: 'text/calendar,*/*;q=0.8' };

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The links in ALMANAC_CALENDARS, each { id, url, host, error }: `error` for one that isn't a
// web address. A calendar's id comes from its link, so it stays the same from one run to the next.
export function calendarLinks(text = '') {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const id = `cal-${hash(entry).slice(0, 16)}`;
      try {
        const url = new URL(entry.replace(/^webcals?:\/\//i, 'https://'));
        if (url.protocol === 'https:' || url.protocol === 'http:') return { id, url: url.href, host: url.host, error: null };
      } catch {
        // Below.
      }
      return { id, url: null, host: null, error: "The link in ALMANAC_CALENDARS isn't a web address." };
    });
}

// What a calendar is called when its feed doesn't say.
const fallbackName = (host) => (/(^|\.)proton\.(me|ch)$/.test(host ?? '') ? 'Proton Calendar' : (host ?? 'Calendar'));

// An event's row: its calendar's id and its UID, or a hash of a UID too long for a row's id.
const eventRow = (calendar, uid) => `${calendar}/${uid.length > 200 ? hash(uid).slice(0, 32) : uid}`;

// Reads `links` into `store` (src/store.js) when `refresh` is called; the server calls it every
// REFRESH_MINUTES. `fetch` and `now` are for tests.
export function createCalendarReader(store, links, { fetch = globalThis.fetch, now = () => new Date() } = {}) {
  const { db } = store.core;
  let running = null;

  // The feed at `url` as its text; a FeedError says why not. The link itself never goes in a
  // message, only its host.
  async function download({ url, host }) {
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new FeedError(err?.name === 'TimeoutError' ? `${host} took too long to answer.` : `Couldn't reach ${host}.`);
    }
    if (!res.ok) throw new FeedError(`${host} answered ${res.status}${res.statusText ? ` (${res.statusText})` : ''}.`);
    const tooBig = new FeedError(`The calendar is over ${MAX_BYTES / 1024 / 1024} MB.`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw tooBig;
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_BYTES) throw tooBig;
        chunks.push(chunk);
      }
    } catch (err) {
      throw err instanceof FeedError ? err : new FeedError(`Couldn't reach ${host}.`);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  // A link read: { name, events } (see parseFeed), or { error }.
  async function read(link) {
    if (link.error) return { error: link.error };
    try {
      return parseFeed(await download(link));
    } catch (err) {
      if (err instanceof FeedError) return { error: err.message };
      throw err;
    }
  }

  // The changes that bring the calendars and events here up to what was read.
  function changes(results) {
    const out = [];
    const set = (tbl, row, fields) => {
      for (const [col, value] of Object.entries(fields)) out.push({ tbl, row, col, value });
    };
    const checkedAt = now().toISOString();
    const removeEvents = (calendar, keep = new Set()) => {
      for (const { id } of db.all('SELECT id FROM events WHERE calendar = ? AND deleted = 0', [calendar])) {
        if (!keep.has(id)) set('events', id, { deleted: true, data: null });
      }
    };
    const configured = new Set(links.map((l) => l.id));
    for (const { id } of db.all('SELECT id FROM calendars WHERE deleted = 0')) {
      if (configured.has(id)) continue;
      set('calendars', id, { deleted: true });
      removeEvents(id);
    }
    links.forEach((link, i) => {
      const result = results[i];
      const current = db.get('SELECT name, error, deleted FROM calendars WHERE id = ?', [link.id]);
      const fields = {};
      const name = result.error ? (current?.name ?? fallbackName(link.host)) : (result.name ?? fallbackName(link.host));
      if (name !== current?.name) fields.name = name;
      if ((result.error ?? null) !== (current?.error ?? null)) fields.error = result.error ?? null;
      if (current?.deleted) fields.deleted = false;
      fields.checked_at = checkedAt;
      set('calendars', link.id, fields);
      // A calendar that couldn't be read keeps the events it had.
      if (result.error) return;
      const had = new Map(db.all('SELECT id, data, deleted FROM events WHERE calendar = ?', [link.id]).map((r) => [r.id, r]));
      const rows = new Set();
      for (const [uid, data] of result.events) {
        const row = eventRow(link.id, uid);
        if (rows.has(row)) continue;
        rows.add(row);
        const before = had.get(row);
        const event = {};
        if (!before) event.calendar = link.id;
        if (before?.data !== JSON.stringify(data)) event.data = data;
        if (before?.deleted) event.deleted = false;
        set('events', row, event);
      }
      removeEvents(link.id, rows);
    });
    return out;
  }

  // Reads every calendar and writes what changed. Resolves with each calendar's { id, name,
  // error, changes }: how many changes it made to its events.
  function refresh() {
    running ??= (async () => {
      try {
        const results = await Promise.all(links.map(read));
        const written = store.writeOwn(changes(results));
        return links.map((link, i) => ({
          id: link.id,
          name: results[i].name ?? db.get('SELECT name FROM calendars WHERE id = ?', [link.id])?.name ?? null,
          error: results[i].error ?? null,
          changes: written.filter((m) => m.tbl === 'events' && m.row.startsWith(`${link.id}/`)).length,
        }));
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { refresh };
}
