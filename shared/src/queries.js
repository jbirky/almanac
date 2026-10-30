import * as Y from 'yjs';
import { occurrences } from './calendar.js';
import { CATEGORY_ORDER } from './categories.js';
import { LABEL_COLORS, isLabelColor } from './labels.js';
import { addDays, fromBase64, journalId, localDate, localDayBounds } from './util.js';

// A task's live subtasks, as `FROM ... WHERE` for counting them.
const SUBTASKS_OF_I = `FROM links sl JOIN items s ON s.id = sl.to_id
  WHERE sl.from_id = i.id AND sl.kind = 'subtask' AND sl.deleted = 0 AND s.deleted = 0`;

const TASK_SELECT = `SELECT i.id, i.title, i.status, i.due, i.done_at, i.created_at, i.deleted,
  (SELECT json_extract(p.value, '$') FROM props p
   WHERE p.item_id = i.id AND p.key = 'category' AND p.deleted = 0 AND json_valid(p.value)) AS category,
  (SELECT json_extract(p.value, '$') FROM props p
   WHERE p.item_id = i.id AND p.key = 'position' AND p.deleted = 0 AND json_valid(p.value)) AS position,
  (SELECT COUNT(*) ${SUBTASKS_OF_I}) AS subtasks,
  (SELECT COUNT(*) ${SUBTASKS_OF_I} AND s.status = 'done') AS subtasks_done
  FROM items i`;

// A subtask shows under its task, not on its own; one whose task was deleted stands alone.
const NOT_SUBTASK = `NOT EXISTS (SELECT 1 FROM links sl JOIN items p ON p.id = sl.from_id
  WHERE sl.to_id = i.id AND sl.kind = 'subtask' AND sl.deleted = 0 AND p.deleted = 0)`;
const OPEN_TASK = `i.type = 'task' AND i.status = 'open' AND i.deleted = 0 AND ${NOT_SUBTASK}`;

// The live journal day a task block sits in, if any.
const JOURNAL_DAY = `(SELECT n.title FROM links l JOIN items n ON n.id = l.from_id
  WHERE l.to_id = i.id AND l.kind = 'embed' AND l.deleted = 0 AND n.deleted = 0 AND n.type = 'journal' LIMIT 1)`;

// Search snippets mark matches with these private-use characters.
export const MATCH_START = '\uE000';
export const MATCH_END = '\uE001';

export function createQueries(db) {
  const queries = {
    task(id) {
      return db.get(`${TASK_SELECT} WHERE i.id = ? AND i.type = 'task'`, [id]) ?? null;
    },

    // The day a task belongs to, to open it from a list: the journal it's written in, else the
    // day it's due. Null for neither.
    taskDay(id) {
      return db.get(`SELECT COALESCE(${JOURNAL_DAY}, i.due) AS day FROM items i WHERE i.id = ?`, [id])?.day ?? null;
    },

    // A task's subtasks, oldest first.
    subtasks(parentId) {
      return db.all(
        `${TASK_SELECT} JOIN links l ON l.to_id = i.id
         WHERE l.from_id = ? AND l.kind = 'subtask' AND l.deleted = 0 AND i.deleted = 0
         ORDER BY i.created_at, i.id`,
        [parentId],
      );
    },

    // Every open task for the list on the left. Tasks never moved there come first, soonest due
    // first and undated ones last, newest first; then those moved, by position (which orders a
    // task among its own category's tasks; the list groups them by category).
    openTasks() {
      return db.all(
        `${TASK_SELECT} WHERE ${OPEN_TASK}
         ORDER BY position IS NOT NULL, position,
           i.due IS NULL, i.due, CASE WHEN i.due IS NULL THEN i.created_at END DESC, i.created_at`,
      );
    },

    // Every category name a task carries, alphabetical.
    categories() {
      return db
        .all(
          `SELECT DISTINCT json_extract(p.value, '$') AS name FROM props p JOIN items i ON i.id = p.item_id
           WHERE p.key = 'category' AND p.deleted = 0 AND json_valid(p.value) AND i.type = 'task' AND i.deleted = 0`,
        )
        .map((r) => r.name)
        .filter((name) => typeof name === 'string' && name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },

    // The task list's order of categories, as last set on any device: a list of names, empty
    // until one is moved.
    categoryOrder() {
      const row = db.get(`SELECT value FROM props WHERE id = ? AND deleted = 0 AND json_valid(value)`, [CATEGORY_ORDER]);
      const names = row ? JSON.parse(row.value) : [];
      return Array.isArray(names) ? names.filter((name) => typeof name === 'string') : [];
    },

    // Every label for notes boxes, alphabetical: its name, color, how many journal days have a
    // box with it, and the latest of those days.
    labels() {
      return db
        .all(
          `SELECT i.id, i.title AS name,
             (SELECT json_extract(p.value, '$') FROM props p
              WHERE p.item_id = i.id AND p.key = 'color' AND p.deleted = 0 AND json_valid(p.value)) AS color,
             (SELECT COUNT(*) FROM links l JOIN items j ON j.id = l.from_id
              WHERE l.to_id = i.id AND l.kind = 'label' AND l.deleted = 0 AND j.deleted = 0) AS days,
             (SELECT MAX(j.title) FROM links l JOIN items j ON j.id = l.from_id
              WHERE l.to_id = i.id AND l.kind = 'label' AND l.deleted = 0 AND j.deleted = 0) AS last
           FROM items i WHERE i.type = 'label' AND i.deleted = 0`,
        )
        .map((l) => ({ ...l, name: l.name ?? '', color: isLabelColor(l.color) ? l.color : LABEL_COLORS[0] }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },

    // The journal days with a notes box under a label, newest first.
    labelDays(labelId) {
      return db
        .all(
          `SELECT j.title AS date FROM links l JOIN items j ON j.id = l.from_id
           WHERE l.to_id = ? AND l.kind = 'label' AND l.deleted = 0 AND j.deleted = 0 AND j.type = 'journal'
           ORDER BY j.title DESC`,
          [labelId],
        )
        .map((r) => r.date);
    },

    // The notes boxes pinned to a day: ones in earlier days' journals, pinned and not unpinned
    // by that day, oldest day first, each { date, box }: the day it's in and its id.
    pinnedBoxes(date) {
      return db.all(
        `SELECT j.title AS date, json_extract(p.value, '$.box') AS box FROM props p JOIN items j ON j.id = p.item_id
         WHERE p.key = 'pin' AND p.deleted = 0 AND json_valid(p.value) AND j.type = 'journal' AND j.deleted = 0
           AND j.title < ? AND (json_extract(p.value, '$.until') IS NULL OR json_extract(p.value, '$.until') > ?)
         ORDER BY j.title, p.id`,
        [date, date],
      );
    },

    // The ids of a day's boxes pinned to the days after it, and not unpinned.
    pinnedFrom(date) {
      return db
        .all(
          `SELECT json_extract(value, '$.box') AS box FROM props
           WHERE item_id = ? AND key = 'pin' AND deleted = 0 AND json_valid(value) AND json_extract(value, '$.until') IS NULL`,
          [journalId(date)],
        )
        .map((r) => r.box);
    },

    // A day's "Due" panel. `due`: every task due that day, journal tasks too, open ones first.
    // `overdue`: on today's page, open tasks due before today. `finished`: tasks finished that
    // day though due another day or never, except ones written in that day's journal, which
    // already shows them checked.
    dayTasks(date, today = localDate()) {
      const [start, end] = localDayBounds(date);
      const due = db.all(
        `${TASK_SELECT} WHERE i.type = 'task' AND i.deleted = 0 AND i.status IN ('open', 'done') AND i.due = ?
           AND ${NOT_SUBTASK}
         ORDER BY i.status != 'open', i.done_at, i.created_at`,
        [date],
      );
      const overdue =
        date === today
          ? db.all(`${TASK_SELECT} WHERE ${OPEN_TASK} AND i.due < ? ORDER BY i.due, i.created_at`, [today])
          : [];
      const finished = db.all(
        `${TASK_SELECT}
         WHERE i.type = 'task' AND i.deleted = 0 AND i.status = 'done' AND i.done_at >= ? AND i.done_at < ?
           AND (i.due IS NULL OR i.due != ?) AND ${NOT_SUBTASK}
           AND NOT EXISTS (SELECT 1 FROM links l
             WHERE l.from_id = ? AND l.to_id = i.id AND l.kind = 'embed' AND l.deleted = 0)
         ORDER BY i.done_at`,
        [start, end, date, journalId(date)],
      );
      return { due, overdue, finished };
    },

    // Per-day counts for the calendar between two local dates (end exclusive): tasks finished,
    // words written in the journal, and open tasks due on days from today on.
    heatmap(startDate, endDate, today = localDate()) {
      const days = {};
      const day = (date) => (days[date] ??= { done: 0, words: 0, due: 0 });
      const [start, end] = localDayBounds(startDate, endDate);
      for (const t of db.all(
        `SELECT done_at FROM items i WHERE type = 'task' AND status = 'done' AND deleted = 0
           AND done_at >= ? AND done_at < ? AND ${NOT_SUBTASK}`,
        [start, end],
      )) {
        day(localDate(new Date(t.done_at))).done++;
      }
      for (const j of db.all(
        `SELECT i.title AS date, b.text FROM items i JOIN bodies b ON b.id = i.id
         WHERE i.type = 'journal' AND i.deleted = 0 AND i.title >= ? AND i.title < ?`,
        [startDate, endDate],
      )) {
        const words = j.text?.split(/\s+/).filter(Boolean).length ?? 0;
        if (words) day(j.date).words = words;
      }
      for (const t of db.all(
        `SELECT due, COUNT(*) AS n FROM items i WHERE ${OPEN_TASK} AND due >= ? AND due < ? GROUP BY due`,
        [today, endDate],
      )) {
        day(t.due).due = t.n;
      }
      return days;
    },

    // The calendars the server reads (server/src/calendars.js), by name: each { id, name, error,
    // checked_at, events }, `error` saying why it couldn't be read the last time it tried.
    calendars() {
      return db
        .all(
          `SELECT c.id, c.name, c.error, c.checked_at,
             (SELECT COUNT(*) FROM events e WHERE e.calendar = c.id AND e.deleted = 0) AS events
           FROM calendars c WHERE c.deleted = 0`,
        )
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
    },

    // The events on a day from those calendars, each { id, calendar, title, location, description,
    // url, allDay, start, end } (see occurrences in calendar.js): all-day ones first, then by when
    // they start.
    dayEvents(date) {
      const rows = db.all(
        `SELECT e.id, e.data, c.name AS calendar FROM events e JOIN calendars c ON c.id = e.calendar
         WHERE e.deleted = 0 AND c.deleted = 0 AND json_valid(e.data)
           AND json_extract(e.data, '$.first') <= ?
           AND (json_extract(e.data, '$.last') IS NULL OR json_extract(e.data, '$.last') >= ?)`,
        [date, date],
      );
      const events = [];
      for (const row of rows) {
        try {
          for (const o of occurrences(JSON.parse(row.data), date, addDays(date, 1))) {
            const { key, ...event } = o;
            events.push({ id: `${row.id}/${key}`, calendar: row.calendar, ...event });
          }
        } catch {
          // An event that can't be worked out isn't shown.
        }
      }
      const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
      return events.sort(
        (a, b) => b.allDay - a.allDay || cmp(a.start, b.start) || cmp(a.end, b.end) || (a.title ?? '').localeCompare(b.title ?? ''),
      );
    },

    body(id) {
      return db.get('SELECT ydoc FROM bodies WHERE id = ?', [id])?.ydoc ?? null;
    },

    // An image's { type, bytes }, or null until it has synced here.
    file(id) {
      const row = db.get('SELECT type, data FROM files WHERE id = ?', [id]);
      return row?.data ? { type: row.type, bytes: fromBase64(row.data) } : null;
    },

    // The part of a body the caller is missing, given its Yjs state vector.
    bodyDiff(id, stateVector) {
      const state = queries.body(id);
      if (!state) return null;
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, state);
        return Y.encodeStateAsUpdate(doc, stateVector);
      } finally {
        doc.destroy();
      }
    },

    // Journal days whose text, or one of whose tasks, matches. A task counts for the day it
    // was written on, else the day it's due, else the day it was finished. Newest day first.
    search(text, limit = 100) {
      const terms = text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t.replaceAll('"', '""')}"*`);
      if (!terms.length) return [];
      const rows = db.all(
        `SELECT i.type, i.title, i.due, i.done_at, ${JOURNAL_DAY} AS journal_day,
           snippet(search, -1, '${MATCH_START}', '${MATCH_END}', '…', 12) AS snippet
         FROM search JOIN items i ON i.id = search.id
         WHERE search MATCH ? AND i.type IN ('journal', 'task') ORDER BY rank LIMIT ?`,
        [terms.join(' '), limit],
      );
      const byDay = new Map();
      for (const r of rows) {
        const date =
          r.type === 'journal' ? r.title : (r.journal_day ?? r.due ?? (r.done_at && localDate(new Date(r.done_at))));
        if (date && !byDay.has(date)) byDay.set(date, { date, snippet: r.snippet });
      }
      return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
    },
  };
  return queries;
}
