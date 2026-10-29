import { createElement as h, useEffect, useMemo, useReducer, useRef } from 'react';
import { Box, Text, useApp, useInput, usePaste, useWindowSize } from 'ink';
import * as chrono from 'chrono-node';
import { addDays, journalId, localDate, matchCategory, moveCategory, parseCapture, relativeDay, shortDay, taskPositions, weekday } from '@almanac/shared';
import { addTask, describeTask } from '../commands.js';
import { readJson, writeJson } from '../config.js';
import { useQuery, useReplica, useSyncStatus, useToday, useVersion } from '../hooks.js';
import { editLine, inputPieces, inputText, insertText, lineInput } from '../input.js';
import { journalDoc, readJournal } from '../journal/layout.js';
import { ReadOnlyError } from '../replica.js';
import { fit, piece, spread } from '../text.js';
import { calendarLines, calendarStart, calendarWeeks, describeDay } from './calendar.js';
import { dayRows } from './day.js';
import { helpRows } from './help.js';
import { findStop, paneLines, scrollTo, stopsOf } from './pane.js';
import { chipPiece } from './rows.js';
import { statusLine } from './status.js';
import { groupTasks, resultRows, taskListRows } from './tasks.js';

const PANES = ['calendar', 'tasks', 'journal'];
const PANE_MODES = { calendar: 'CALENDAR', tasks: 'TASKS', journal: 'JOURNAL' };
const INPUT_MODES = {
  capture: 'ADD TASK',
  dueAdd: 'ADD TASK',
  search: 'SEARCH',
  rename: 'RENAME',
  category: 'CATEGORY',
  date: 'DUE DATE',
  subtask: 'SUBTASK',
  goto: 'GO TO',
};
const LEFT = { initial: 45, min: 30 };
// What's above the task list on the left: search, the calendar, the open day's line, the task
// box and what it read.
const LEFT_TOP = 15;
const MIN_SIZE = { columns: 72, rows: 18 };
const NOTICE_MS = 6000;
const NOT_YET = 'Writing in the journal comes to the terminal in the next version. Tasks can be added with a.';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// The app's state, held in a ref so that keys arriving together (typed fast, or pasted) each
// see what the one before did.
function useStore(init) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = init();
  const [, rerender] = useReducer((n) => n + 1, 0);
  const set = useRef((patch) => {
    ref.current = { ...ref.current, ...(typeof patch === 'function' ? patch(ref.current) : patch) };
    rerender();
  }).current;
  return [ref, set];
}

function readDay(state) {
  const doc = journalDoc(state);
  if (!doc) return [];
  try {
    return readJournal(doc);
  } finally {
    doc.destroy();
  }
}

// The categories a picker offers for what's typed: those containing it, then a new one of that
// name, or (with nothing typed, on a task that has one) none.
function categoryOptions(text, categories, current) {
  const typed = text.trim();
  const lower = typed.toLowerCase();
  const options = categories.filter((c) => c.toLowerCase().includes(lower)).map((name) => ({ name, label: name }));
  if (typed && !categories.some((c) => c.toLowerCase() === lower)) options.push({ name: typed, label: `new category “${typed}”`, isNew: true });
  if (!typed && current) options.push({ name: null, label: 'No category' });
  return options;
}

// The date a "go to" line names: "fri", "oct 3", "2025-12-24", "yesterday". Unlike a due date,
// it can be in the past.
function readDate(text, now = new Date()) {
  const date = chrono.parseDate(text, now);
  return date ? localDate(date) : null;
}

// A task-box line as it reads as a task: its title, due date and category, with "new" on a
// category no task has yet.
function capturePreview(text, categories, today, theme) {
  if (!text.trim()) return null;
  const parsed = parseCapture(text);
  const category = parsed.category ? matchCategory(parsed.category, categories) : null;
  const out = [piece(parsed.title || 'No title yet', { fg: parsed.title ? theme.muted : theme.faint })];
  if (parsed.due) out.push(piece('  '), piece(` ${relativeDay(parsed.due, today)} `, { fg: theme.text, bg: theme.chip }));
  if (category) {
    out.push(piece(' '), chipPiece(category, theme));
    if (!categories.includes(category)) out.push(piece(' new', { fg: theme.accent, bold: true }));
  }
  return out;
}

export function App({ theme, paths }) {
  const replica = useReplica();
  const app = useApp();
  const { columns, rows: screenRows } = useWindowSize();
  const today = useToday();
  const status = useSyncStatus();
  const [store, set] = useStore(() => {
    const saved = readJson(paths.state);
    return {
      pane: 'journal',
      day: localDate(),
      query: '',
      // What's being typed: { kind, key (the stop it's at), line, target, choice, placeholder }.
      input: null,
      notice: null,
      help: false,
      undo: null,
      // A task to put the journal's cursor on once its day shows.
      seek: null,
      cursor: { tasks: null, results: null, journal: null },
      leftWidth: Number.isInteger(saved.leftWidth) ? saved.leftWidth : LEFT.initial,
      openSubtasks: new Set(Array.isArray(saved.openSubtasks) ? saved.openSubtasks : []),
    };
  });
  const s = store.current;
  const calendarRef = useRef(null);
  const scrollRef = useRef({ tasks: 0, results: 0, journal: 0 });
  // Where each pane's cursor was, for when what it was on goes away.
  const indexRef = useRef({ tasks: 0, results: 0, journal: 0 });
  const noticeTimer = useRef(null);
  const quitting = useRef(false);

  // Layout.
  const lw = clamp(s.leftWidth, LEFT.min, Math.max(LEFT.min, columns - 50));
  const height = screenRows - 1;
  const rw = columns - lw - 1;
  const weeks = calendarWeeks(lw - 2);
  const first = calendarStart(calendarRef.current?.weeks === weeks ? calendarRef.current.first : null, s.day, today, weeks);
  calendarRef.current = { first, weeks };

  // Data. Everything is in the copy on this machine, so it's all read on each render.
  const bodies = useVersion(['bodies']);
  const tasks = useQuery('openTasks');
  const order = useQuery('categoryOrder');
  const categories = useQuery('categories');
  const labelList = useQuery('labels');
  const labels = useMemo(() => new Map(labelList.map((l) => [l.id, l])), [labelList]);
  const dueTasks = useQuery('dayTasks', [s.day, today]);
  const pins = useQuery('pinnedBoxes', [s.day]);
  const pinnedFromList = useQuery('pinnedFrom', [s.day]);
  const pinnedFrom = useMemo(() => new Set(pinnedFromList), [pinnedFromList]);
  const query = s.query.trim();
  const searching = query !== '';
  const results = useQuery('search', [query], ['items', 'bodies', 'links']);
  const counts = useQuery('heatmap', [first, addDays(first, 7 * weeks), today], ['items', 'bodies']);
  const body = useQuery('body', [journalId(s.day)], ['bodies']);
  const blocks = useMemo(() => readDay(body), [body]);
  const pinned = useMemo(() => {
    const days = new Map();
    const out = [];
    for (const pin of pins) {
      if (!days.has(pin.date)) days.set(pin.date, readDay(replica.queries.body(journalId(pin.date))));
      const box = days.get(pin.date).find((b) => b.kind === 'box' && b.id === pin.box);
      if (box) out.push({ date: pin.date, box });
    }
    return out;
    // `bodies` goes up when any day's journal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, bodies, replica]);
  const { groups, named } = useMemo(() => groupTasks(tasks, order), [tasks, order]);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // --- What the rows need to draw what's being typed.
  const input = s.input;
  const typed = (key, w) =>
    input?.key === key ? inputPieces(input.line, w, { fg: theme.text, faint: theme.faint, placeholder: input.placeholder }) : null;
  const preview = (key) => (input?.key === key ? capturePreview(inputText(input.line), categories, today, theme) : null);
  const picker = (key, rows, { lead, margin, bg }) => {
    if (input?.key !== key || (input.kind !== 'category' && input.kind !== 'date')) return;
    const room = (input.pane === 'tasks' ? lw - 2 : rw - 1) - margin - lead.reduce((n, p) => n + p.text.length, 0) - 2;
    const pop = (line, popBg = theme.pop) => rows.push({ line: [...lead, ...fit(line, pw, popBg)], margin, bg, part: key, popup: true });
    const pw = Math.min(input.kind === 'category' ? 34 : 46, room);
    if (input.kind === 'category') {
      pop([piece(' category ', { fg: theme.muted }), ...inputPieces(input.line, pw - 11, { fg: theme.text })]);
      const options = categoryOptions(inputText(input.line), categories, input.target.category);
      const choice = clamp(input.choice, 0, options.length - 1);
      const start = clamp(choice - 2, 0, Math.max(0, options.length - 6));
      options.slice(start, start + 6).forEach((o, i) => {
        const chosen = start + i === choice;
        const label = o.isNew ? [piece(' + ', { fg: theme.accent }), piece(o.label, { fg: theme.muted })] : [piece(` ${o.label}`, { bold: chosen || undefined })];
        pop(label, chosen ? theme.accentSoft : theme.pop);
      });
      pop([piece(' Enter picks · Esc cancels', { fg: theme.faint })]);
    } else {
      const text = inputText(input.line).trim();
      const due = text ? parseCapture(text).due : null;
      const result = !text ? piece('no due date', { fg: theme.muted }) : due ? piece(shortDay(due, today)) : piece('can’t read a date', { fg: theme.late });
      pop([piece(' due ', { fg: theme.muted }), ...inputPieces(input.line, 16, { fg: theme.text }), piece('  → ', { fg: theme.muted }), result]);
      pop([piece(' Enter sets · Esc cancels', { fg: theme.faint })]);
    }
  };
  const base = {
    theme,
    today,
    typed,
    preview,
    picker,
    labels,
    pinnedFrom,
    openSubtasks: s.openSubtasks,
    subtasksOf: (id) => replica.queries.subtasks(id),
    task: (id) => replica.queries.task(id),
  };

  // Each pane's rows, its stops and the one its cursor is on. A pane's rows depend on where its
  // cursor is (the cursor's task shows its category and date), so they're made again when the
  // cursor turns out to be somewhere other than where it was left.
  // Until it's moved, a pane's cursor is on its first stop, whatever comes first once synced.
  const paneModel = (name, make) => {
    const key = s.cursor[name];
    let rows = make(key);
    let stops = stopsOf(rows);
    let stop = key === null ? (stops[0] ?? null) : findStop(stops, key, indexRef.current[name]);
    if (stop && stop.key !== key) {
      if (key !== null) s.cursor = { ...s.cursor, [name]: stop.key };
      rows = make(stop.key);
      stops = stopsOf(rows);
      stop = findStop(stops, stop.key);
    }
    if (stop) indexRef.current[name] = stops.indexOf(stop);
    return { rows, stops, stop };
  };
  // A task just opened from a list: the journal's cursor goes to it, where it's written if it
  // is, else in the Due panel.
  const seek = (name, make) => {
    const id = s.seek;
    if (!id) return;
    const stops = stopsOf(make(null));
    const found = stops.find((x) => x.data?.task?.id === id && x.data.block) ?? stops.find((x) => x.data?.task?.id === id);
    s.seek = null;
    if (found) s.cursor = { ...s.cursor, [name]: found.key };
  };
  const listName = searching ? 'results' : 'tasks';
  const listHeight = Math.max(1, height - LEFT_TOP);
  const list = paneModel(listName, (cursor) =>
    searching
      ? resultRows({ ...base, w: lw - 2 }, results)
      : taskListRows({ ...base, w: lw - 2, day: null, cursor: s.pane === 'tasks' ? cursor : null }, groups),
  );
  const makeJournal = (cursor) =>
    s.help
      ? helpRows(s.pane, searching, theme)
      : dayRows({ ...base, day: s.day, dueTasks, pinned, blocks, w: rw - 1, cursor: s.pane === 'journal' ? cursor : null });
  seek('journal', makeJournal);
  const journal = paneModel('journal', makeJournal);
  scrollRef.current[listName] = scrollTo(list.stop, listHeight, scrollRef.current[listName], list.rows.length);
  scrollRef.current.journal = s.help ? 0 : scrollTo(journal.stop, height, scrollRef.current.journal, journal.rows.length);

  // --- Doing things.
  const notice = (text, tone = 'info') => {
    clearTimeout(noticeTimer.current);
    set({ notice: { text, tone } });
    noticeTimer.current = setTimeout(() => set((st) => (st.notice?.text === text ? { notice: null } : {})), NOTICE_MS);
  };
  const act = (name, ...args) => {
    try {
      return replica.act(name, ...args);
    } catch (err) {
      notice(err instanceof ReadOnlyError ? err.message : `Couldn’t do that: ${err.message}`, 'warn');
      return undefined;
    }
  };
  const writable = () => {
    if (!replica.status.readOnly) return true;
    notice(new ReadOnlyError().message, 'warn');
    return false;
  };
  // Why the copy is read-only, once as it opens, and word when it can write after all.
  const wasReadOnly = useRef(null);
  useEffect(() => {
    if (status.readOnly) notice(new ReadOnlyError().message);
    else if (wasReadOnly.current) notice('The other terminal closed, so this one can write now.');
    wasReadOnly.current = status.readOnly;
    // `notice` is made each render; this runs only when the copy changes hands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.readOnly]);
  const keepState = (patch) => {
    const next = { ...store.current, ...patch };
    writeJson(paths.state, { leftWidth: next.leftWidth, openSubtasks: [...next.openSubtasks] });
    set(patch);
  };
  const openDay = (day, patch = {}) => {
    if (day !== store.current.day) {
      scrollRef.current.journal = 0;
      indexRef.current.journal = 0;
      set({ day, cursor: { ...store.current.cursor, journal: null }, ...patch });
    } else {
      set(patch);
    }
  };
  const startInput = (inputState, patch = {}) =>
    set({ input: { line: lineInput(''), choice: 0, pane: store.current.pane, ...inputState }, notice: null, ...patch });
  const setSubtasksOpen = (id, open) => {
    const next = new Set(store.current.openSubtasks);
    if (open) next.add(id);
    else next.delete(id);
    keepState({ openSubtasks: next });
  };
  const quit = async () => {
    if (quitting.current) return;
    quitting.current = true;
    if (replica.status.pending) {
      set({ notice: { text: 'Syncing before quitting…', tone: 'info' } });
      await Promise.race([replica.sync(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    app.exit();
  };

  const moveTask = (task, group, dir) => {
    const tasksIn = groups.find((g) => g.name === group)?.tasks ?? [];
    const index = tasksIn.findIndex((t) => t.id === task.id) + dir;
    if (index < 0 || index >= tasksIn.length) return;
    const others = tasksIn.filter((t) => t.id !== task.id);
    act('moveTask', task.id, taskPositions(task.id, others, index), undefined);
  };

  const taskKey = (ch, key, stop) => {
    const { task, parent, block } = stop.data;
    const sub = stop.data.kind === 'subtask';
    const name = task.title || 'Untitled task';
    if (task.missing) return key.return || (ch && 'xrcdsAD '.includes(ch)) ? notice('This task hasn’t synced to this machine yet.') : undefined;
    if (ch === 'x' || ch === ' ') return writable() && act('setTaskStatus', task.id, task.status === 'open' ? 'done' : 'open');
    if (ch === 'r') return writable() && startInput({ kind: 'rename', key: `${stop.key}#title`, line: lineInput(task.title ?? ''), target: task });
    if (key.return) {
      const day = replica.queries.taskDay((sub ? parent : task).id);
      if (!day) return notice(`“${name}” isn’t written in a journal or due on a day.`);
      return openDay(day, { pane: 'journal', seek: (sub ? parent : task).id });
    }
    if (ch === 'D') {
      if (!writable()) return undefined;
      if (block) return notice('The journal can’t be changed here yet: delete it from the task list, or on the web.');
      const ids = sub ? (act('deleteItem', task.id), [task.id]) : act('deleteTask', task.id);
      if (!ids) return undefined;
      set({ undo: { ids, name } });
      return notice(`Deleted “${name}”${ids.length > 1 ? ' and its subtasks' : ''}. u brings ${ids.length > 1 ? 'them' : 'it'} back.`);
    }
    if (key.meta && (key.upArrow || key.downArrow)) {
      if (store.current.pane !== 'tasks') return notice('Moving blocks in the journal comes with writing, in the next version.');
      if (sub) return undefined;
      return writable() && moveTask(task, stop.data.group, key.upArrow ? -1 : 1);
    }
    if (sub) return ch && 'cdsA'.includes(ch) ? notice('Subtasks have no category or due date of their own.') : undefined;
    if (ch === 'c') {
      if (!writable()) return undefined;
      const choice = Math.max(0, categories.indexOf(task.category));
      return startInput({ kind: 'category', key: stop.key, target: task, choice });
    }
    if (ch === 'd') return writable() && startInput({ kind: 'date', key: stop.key, target: task });
    if (ch === 's') return setSubtasksOpen(task.id, !store.current.openSubtasks.has(task.id));
    if (ch === 'A') {
      if (!writable()) return undefined;
      setSubtasksOpen(task.id, true);
      const addKey = `${stop.key}/add`;
      const pane = store.current.pane === 'tasks' ? 'tasks' : 'journal';
      return startInput({ kind: 'subtask', key: addKey, target: task, placeholder: 'Add a subtask' }, { cursor: { ...store.current.cursor, [pane]: addKey } });
    }
    return undefined;
  };

  const submitInput = () => {
    const st = store.current;
    const { kind, line, target } = st.input;
    const text = inputText(line).trim();
    const close = (patch = {}) => set({ input: null, ...patch });
    if (kind === 'capture' || kind === 'dueAdd') {
      if (!text) return close();
      try {
        const task = addTask(replica, text, kind === 'dueAdd' ? st.day : null);
        set({ input: { ...st.input, line: lineInput('') } });
        return notice(`Added ${describeTask(task, today)}${task.isNew ? ' (new category)' : ''}`);
      } catch (err) {
        return notice(err instanceof ReadOnlyError ? err.message : err.message, 'warn');
      }
    }
    if (kind === 'search') return close({ pane: 'tasks' });
    if (kind === 'goto') {
      if (!text) return close();
      const day = readDate(text);
      if (!day) return notice(`Couldn’t read a date in “${text}”.`, 'warn');
      return openDay(day, { input: null });
    }
    if (kind === 'rename') {
      if (text !== (target.title ?? '')) act('updateItem', target.id, { title: text });
      return close();
    }
    if (kind === 'category') {
      const options = categoryOptions(text, categories, target.category);
      const name = options.length ? options[clamp(st.input.choice, 0, options.length - 1)].name : matchCategory(text, categories);
      if ((name ?? null) !== (target.category ?? null)) act('setCategory', target.id, name);
      return close();
    }
    if (kind === 'date') {
      const due = text ? parseCapture(text).due : null;
      if (text && !due) return notice(`Couldn’t read a date in “${text}”.`, 'warn');
      if (due !== (target.due ?? null)) act('updateItem', target.id, { due });
      return close();
    }
    if (kind === 'subtask') {
      if (!text) return close();
      act('addSubtask', target.id, text);
      return set({ input: { ...st.input, line: lineInput('') } });
    }
    return close();
  };

  const inputKey = (ch, key) => {
    const st = store.current;
    const { kind } = st.input;
    if (key.escape) return set(kind === 'search' ? { input: null, query: '' } : { input: null });
    if (key.return) return submitInput();
    if (kind === 'search' && (key.tab || key.downArrow)) return set({ input: null, pane: 'tasks' });
    if (kind === 'category' && (key.upArrow || key.downArrow)) {
      const options = categoryOptions(inputText(st.input.line), categories, st.input.target.category);
      return set({ input: { ...st.input, choice: clamp(st.input.choice + (key.upArrow ? -1 : 1), 0, options.length - 1) } });
    }
    const next = editLine(st.input.line, ch, key);
    if (!next) return undefined;
    const changed = inputText(next) !== inputText(st.input.line);
    return set({
      input: { ...st.input, line: next, choice: kind === 'category' && changed ? 0 : st.input.choice },
      ...(kind === 'search' ? { query: inputText(next) } : {}),
    });
  };

  // The cursor's pane, its model and the rows a page holds.
  const focusedList = () => {
    const st = store.current;
    if (st.pane === 'journal') return { name: 'journal', model: journal, page: height };
    if (st.pane === 'tasks') return { name: listName, model: list, page: listHeight };
    return null;
  };

  const moveCursor = (target, dir) => {
    const { name, model, page } = target;
    const { stops, stop } = model;
    if (!stops.length) return;
    const at = Math.max(0, stops.indexOf(stop));
    let next = at + dir;
    // Home and End: the first or last stop.
    if (!Number.isFinite(dir)) next = dir > 0 ? stops.length - 1 : 0;
    else if (Math.abs(dir) > 1) {
      // Half a page: to the stop that far down (or up) the rows.
      const row = (stop?.index ?? 0) + Math.sign(dir) * Math.floor(page / 2);
      next = dir > 0 ? stops.findIndex((x) => x.index >= row) : stops.findLastIndex((x) => x.index <= row);
      if (next < 0) next = dir > 0 ? stops.length - 1 : 0;
    }
    next = clamp(next, 0, stops.length - 1);
    set({ cursor: { ...store.current.cursor, [name]: stops[next].key } });
  };

  const handleKey = (ch, key) => {
    const st = store.current;
    if (key.ctrl && ch === 'c') return quit();
    if (st.help) return set({ help: false });
    if (st.input) return inputKey(ch, key);
    if (st.notice) set({ notice: null });

    // Everywhere.
    if (key.tab) return set({ pane: PANES[(PANES.indexOf(st.pane) + (key.shift ? -1 : 1) + PANES.length) % PANES.length] });
    if ((key.ctrl && ch === 'k') || ch === 'a') {
      return writable() && startInput({ kind: 'capture', key: 'capture', placeholder: 'Add a task: "draft intro fri #paper"' }, { query: '', pane: 'tasks' });
    }
    if (ch === '/') return startInput({ kind: 'search', key: 'search', line: lineInput(st.query), placeholder: 'Search' }, { pane: 'tasks' });
    if (ch === '[' || ch === ']') return openDay(addDays(st.day, ch === '[' ? -1 : 1));
    if (ch === 't') return openDay(today);
    if (ch === 'g') return startInput({ kind: 'goto', key: 'goto', placeholder: 'fri, oct 3, 2025-12-24' });
    if (ch === '<' || ch === '>') return keepState({ leftWidth: clamp(lw + (ch === '<' ? -2 : 2), LEFT.min, Math.max(LEFT.min, columns - 50)) });
    if (key.ctrl && ch === 's') {
      replica.sync();
      return notice(replica.status.readOnly ? new ReadOnlyError().message : 'Syncing…');
    }
    if (ch === 'q') return quit();
    if (ch === '?') return set({ help: true });
    if (ch === 'u') {
      if (!st.undo) return notice('Nothing to bring back.');
      if (!writable()) return undefined;
      act('restoreItems', st.undo.ids);
      set({ undo: null });
      return notice(`Brought back “${st.undo.name}”.`);
    }
    if (ch === 'v') return notice('By label comes to the terminal in a later version.');
    if (key.escape && st.query) return set({ query: '' });

    if (st.pane === 'calendar') {
      const step = key.leftArrow || ch === 'h' ? -7 : key.rightArrow || ch === 'l' ? 7 : key.upArrow || ch === 'k' ? -1 : key.downArrow || ch === 'j' ? 1 : 0;
      if (step) return openDay(addDays(st.day, step));
      if (key.return) return set({ pane: 'journal' });
      return undefined;
    }

    const target = focusedList();
    const stop = target.model.stop;
    const data = stop?.data;
    // Alt+↑ and Alt+↓ move what's under the cursor; plain arrows move the cursor.
    if (key.meta && (key.upArrow || key.downArrow)) {
      if (data?.kind === 'task' || data?.kind === 'subtask') return taskKey(ch, key, stop);
      if (data?.kind === 'category' && data.name) {
        if (!writable()) return undefined;
        const index = named.indexOf(data.name) + (key.upArrow ? -1 : 1);
        if (index < 0 || index >= named.length) return undefined;
        return act('setCategoryOrder', moveCategory(named, order, data.name, index));
      }
      return undefined;
    }
    if (key.downArrow || ch === 'j') return moveCursor(target, 1);
    if (key.upArrow || ch === 'k') return moveCursor(target, -1);
    if (key.pageDown || (key.ctrl && ch === 'd')) return moveCursor(target, 2);
    if (key.pageUp || (key.ctrl && ch === 'u')) return moveCursor(target, -2);
    if (key.home) return moveCursor(target, -Infinity);
    if (key.end) return moveCursor(target, Infinity);
    if (!data) return undefined;

    if (data.kind === 'task' || data.kind === 'subtask') return taskKey(ch, key, stop);
    if (data.kind === 'result' && key.return) return openDay(data.date, { pane: 'journal' });
    if (data.kind === 'addSubtask' && (key.return || ch === 'A' || ch === 'i')) {
      return writable() && startInput({ kind: 'subtask', key: stop.key, target: data.parent, placeholder: 'Add a subtask' });
    }
    if (data.kind === 'dueAdd' && (key.return || ch === 'i')) {
      return writable() && startInput({ kind: 'dueAdd', key: 'due-add', placeholder: 'Add a task: "draft intro #paper"' });
    }
    if (data.kind === 'pinHeader') {
      if (key.return) return openDay(data.date);
      if (ch === 'p') return writable() && act('unpinBox', data.date, data.box.id, st.day);
    }
    if (data.kind === 'boxHeader' && ch === 'p') {
      if (!data.box.id) return notice('This box is older than pinning: pin it on the web once, and it can be pinned here after.');
      if (!writable()) return undefined;
      if (pinnedFrom.has(data.box.id)) {
        act('unpinBox', st.day, data.box.id, st.day);
        return notice('Unpinned. It no longer shows on the days after this one.');
      }
      act('pinBox', st.day, data.box.id);
      return notice('Pinned. It shows on each day after this one until it’s unpinned.');
    }
    if (st.pane === 'journal' && (key.return || (ch && 'ioOn'.includes(ch)))) return notice(NOT_YET);
    return undefined;
  };

  useInput(handleKey);
  usePaste((text) => {
    const st = store.current;
    if (!st.input) return;
    const line = insertText(st.input.line, text);
    set({ input: { ...st.input, line }, ...(st.input.kind === 'search' ? { query: inputText(line) } : {}) });
  });

  // --- The screen.
  if (columns < MIN_SIZE.columns || screenRows < MIN_SIZE.rows) {
    return h(
      Box,
      { width: columns, height: screenRows, alignItems: 'center', justifyContent: 'center' },
      h(Text, { color: theme.muted }, `Make the terminal at least ${MIN_SIZE.columns} × ${MIN_SIZE.rows} for Almanac (it's ${columns} × ${screenRows}).`),
    );
  }

  const left = [];
  const leftLine = (line, { bg, mark = false } = {}) =>
    left.push([piece(mark ? '▌' : ' ', { fg: theme.accent }), ...fit(line, lw - 2, bg), piece(' ')]);
  // Search.
  if (input?.kind === 'search') leftLine([piece('/ ', { fg: theme.accent, bold: true }), ...typed('search', lw - 4)]);
  else if (searching) leftLine(spread([piece('/ ', { fg: theme.muted, bold: true }), piece(s.query)], [piece('Esc clears', { fg: theme.faint })], lw - 2));
  else leftLine([piece('/ ', { fg: theme.muted, bold: true }), piece('Search', { fg: theme.faint })]);
  leftLine([]);
  // The calendar, showing search results' days while there's a search.
  const matches = searching ? new Set(results.map((r) => r.date)) : null;
  calendarLines({ first, weeks, day: s.day, today, counts, matches, matchColor: theme.match, theme }).forEach((line, i) =>
    leftLine(line, { mark: s.pane === 'calendar' && i === weekday(s.day) + 1 }),
  );
  leftLine([]);
  const dayName = s.day === today ? 'Today' : s.day === addDays(today, -1) ? 'Yesterday' : s.day === addDays(today, 1) ? 'Tomorrow' : shortDay(s.day, today);
  const described = describeDay(dayName, counts[s.day]);
  leftLine([piece(described.name), piece(described.rest, { fg: theme.muted })]);
  leftLine([]);
  // The task box.
  const capturing = input?.kind === 'capture';
  leftLine(
    [piece(' + ', { fg: theme.accent }), ...(capturing ? typed('capture', lw - 6) : [piece('Add a task: "draft intro fri #paper"', { fg: theme.faint })])],
    { bg: theme.panel },
  );
  leftLine(capturing ? [piece('   '), ...(preview('capture') ?? [])] : []);
  // The task list, or the search's days.
  const listTop = scrollRef.current[listName];
  for (const line of paneLines(list.rows, { w: lw - 1, height: listHeight, top: listTop, stop: list.stop, focused: s.pane === 'tasks', theme })) {
    left.push([...line, piece(' ')]);
  }

  const right = paneLines(journal.rows, { w: rw, height, top: scrollRef.current.journal, stop: journal.stop, focused: s.pane === 'journal' && !s.help, theme });
  const lines = [];
  for (let y = 0; y < height; y++) lines.push([...(left[y] ?? [piece(' '.repeat(lw))]), piece('│', { fg: theme.line }), ...right[y]]);

  // The status bar.
  const mode = input ? INPUT_MODES[input.kind] : s.help ? 'KEYS' : PANE_MODES[s.pane] === 'TASKS' && searching ? 'SEARCH' : PANE_MODES[s.pane];
  let typingLine = null;
  if (input?.kind === 'goto') {
    const day = readDate(inputText(input.line));
    typingLine = [
      piece('Go to ', { fg: theme.muted }),
      ...typed('goto', 24),
      piece('  '),
      piece(inputText(input.line).trim() ? (day ? shortDay(day, today) : 'can’t read a date') : '', { fg: day ? theme.text : theme.late }),
    ];
  }
  lines.push(
    statusLine({
      status,
      mode,
      typingMode: Boolean(input),
      hints: hintsFor(s, input, (s.pane === 'journal' ? journal : list).stop, searching),
      notice: s.notice,
      line: typingLine,
      theme,
      w: columns,
    }),
  );

  return h(
    Box,
    { flexDirection: 'column', width: columns, height: screenRows },
    lines.map((line, i) =>
      h(
        Text,
        { key: i, wrap: 'truncate-end' },
        line.map((p, j) =>
          h(
            Text,
            {
              key: j,
              color: p.fg,
              backgroundColor: p.bg,
              bold: p.bold,
              italic: p.italic,
              underline: p.underline,
              strikethrough: p.strike,
              inverse: p.inverse,
            },
            p.text,
          ),
        ),
      ),
    ),
  );
}

// The keys the status bar lists for where the cursor is and what's being typed.
function hintsFor(s, input, stop, searching) {
  if (input) {
    return {
      capture: [['Enter', 'add'], ['Esc', 'done']],
      dueAdd: [['Enter', 'add'], ['Esc', 'done']],
      search: [['Enter', 'see the days'], ['Esc', 'clear']],
      rename: [['Enter', 'save'], ['Esc', 'cancel']],
      category: [['↑↓', 'choose'], ['Enter', 'pick'], ['Esc', 'cancel']],
      date: [['Enter', 'set'], ['Esc', 'cancel']],
      subtask: [['Enter', 'add'], ['Esc', 'done']],
      goto: [['Enter', 'go'], ['Esc', 'cancel']],
    }[input.kind];
  }
  if (s.help) return [['any key', 'close']];
  const keys = [['?', 'keys']];
  if (s.pane === 'calendar') return [['←→', 'week'], ['↑↓', 'day'], ['Enter', 'journal'], ['Tab', 'pane'], ...keys];
  const kind = stop?.data?.kind;
  if (kind === 'task') {
    const move = s.pane === 'tasks' ? [['Alt+↑↓', 'move']] : [];
    return [['x', 'done'], ['c', 'category'], ['d', 'date'], ['s', 'subtasks'], ...move, ['Enter', 'its day'], ...keys];
  }
  if (kind === 'subtask') return [['x', 'done'], ['r', 'rename'], ['D', 'delete'], ...keys];
  if (kind === 'category') return [['Alt+↑↓', 'move category'], ['j k', 'move'], ...keys];
  if (kind === 'result') return [['Enter', 'open day'], ['j k', 'move'], ['Esc', 'clear'], ...keys];
  if (kind === 'addSubtask' || kind === 'dueAdd') return [['Enter', 'add a task'], ...keys];
  if (kind === 'pinHeader') return [['Enter', 'its day'], ['p', 'unpin'], ...keys];
  if (kind === 'boxHeader') return [['p', 'pin or unpin'], ['[ ]', 'day'], ...keys];
  if (searching && s.pane === 'tasks') return [['Esc', 'clear'], ...keys];
  return [['j k', 'move'], ['[ ]', 'day'], ['t', 'today'], ['a', 'add task'], ...keys];
}
