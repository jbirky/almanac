import os from 'node:os';
import { createElement as h, useEffect, useMemo, useReducer, useRef } from 'react';
import { Box, Text, useApp, useInput, usePaste, useWindowSize } from 'ink';
import * as Y from 'yjs';
import * as chrono from 'chrono-node';
import {
  LABEL_COLORS,
  addDays,
  localDate,
  matchCategory,
  moveCategory,
  newId,
  parseCapture,
  relativeDay,
  resolveLabel,
  sameLabel,
  shortDay,
  taskPositions,
  weekday,
} from '@almanac/shared';
import { addTask, describeTask } from '../commands.js';
import { readJson, writeJson } from '../config.js';
import { useJournals, useQuery, useReplica, useSyncStatus, useToday } from '../hooks.js';
import { imageLines, openImage } from '../images.js';
import { editLine, inputPieces, inputText, insertText, lineInput } from '../input.js';
import { caretFromRel, caretToRel } from '../journal/caret.js';
import { insertBox, isBox, isElement, newParagraph, textLength, unwrapBox } from '../journal/doc.js';
import * as edits from '../journal/edit.js';
import { keyOf, readJournal } from '../journal/layout.js';
import { ReadOnlyError } from '../replica.js';
import { fit, piece, spread } from '../text.js';
import { calendarLines, calendarStart, calendarWeeks, describeDay } from './calendar.js';
import { dayRows } from './day.js';
import { helpRows } from './help.js';
import { labelRows, labelUse, pickLabel } from './label.js';
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
  title: 'WRITE',
  latex: 'EQUATION',
  label: 'LABEL',
  boxMenu: 'BOX',
  labelPick: 'LABEL',
  labelMenu: 'LABEL',
  labelName: 'RENAME',
  labelColor: 'COLOR',
  labelDelete: 'LABEL',
};
const LEFT = { initial: 45, min: 30 };
// What's above the task list on the left: search, the calendar, the open day's line, the task
// box and what it read.
const LEFT_TOP = 15;
const MIN_SIZE = { columns: 40, rows: 16 };
// Below this many columns one pane fits, as on a phone: the journal, or the calendar and tasks.
const NARROW = 100;
const NOTICE_MS = 6000;
// How long a task's title waits, once typing in it stops, before it's saved.
const TITLE_SAVE_MS = 500;
// How many days by label show at first, and how many more each time the cursor reaches the end.
const LABEL_PAGE = 14;

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

// A journal's blocks, read again only when its document has changed.
const read = new WeakMap();
function blocksOf(session) {
  const cached = read.get(session);
  if (cached?.version === session.version) return cached.blocks;
  const blocks = readJournal(session.doc);
  read.set(session, { version: session.version, blocks });
  return blocks;
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

// The labels a box's label picker offers for what's typed, as the web's does: those whose name
// contains it or is the same label, then a new one of that name (with `create`), or with nothing
// typed (and `none`, for a new box or one with a label) no label.
function labelOptions(text, labels, { none = false, create = true } = {}) {
  const typed = text.trim();
  const lower = typed.toLowerCase();
  const shown = typed ? labels.filter((l) => l.name.toLowerCase().includes(lower) || sameLabel(l.name, typed)) : labels;
  const options = shown.map((l) => ({ id: l.id, label: l.name, color: l.color }));
  if (create && typed && !labels.some((l) => sameLabel(l.name, typed))) options.push({ create: typed, label: `new label “${typed}”`, isNew: true });
  if (!typed && none) options.push({ id: null, label: 'No label' });
  return options;
}

// What Enter on a box's label offers. `label` is the box's label, if it has one.
function boxMenu(box, label, pinned) {
  return [
    ...(label ? [{ id: 'byLabel', label: `All “${label.name}” notes, by label` }] : []),
    { id: 'label', label: 'Change its label' },
    ...(label ? [{ id: 'editLabel', label: `Rename, recolor or delete “${label.name}”` }] : []),
    ...(box.id ? [{ id: 'pin', label: pinned ? 'Unpin it from the days after this one' : 'Pin it to the days after this one' }] : []),
    { id: 'unwrap', label: 'Remove the box, keep its notes' },
    { id: 'delete', label: 'Delete the box and its notes' },
  ];
}

// What e offers for a label.
const labelMenu = (label) => [
  { id: 'rename', label: `Rename “${label.name}”` },
  { id: 'color', label: 'Change its color' },
  { id: 'delete', label: 'Delete the label' },
];

// The colors a label can take: the palette's, then one typed as #rrggbb.
function colorOptions(text) {
  const typed = text.trim().toLowerCase();
  const options = LABEL_COLORS.filter((c) => !typed || c.startsWith(typed)).map((c) => ({ id: c, label: c[0].toUpperCase() + c.slice(1), color: c }));
  if (/^#[0-9a-f]{6}$/.test(typed)) options.unshift({ id: typed, label: typed, color: typed });
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

// The block at the top of the journal that `node` is in.
function topOf(node) {
  let top = node;
  while (top.parent instanceof Y.XmlElement) top = top.parent;
  return top;
}

// The box a node is in, or null.
function boxOf(node) {
  for (let at = node; at; at = at.parent) if (isBox(at)) return at;
  return null;
}

// Where the cursor can go while writing: textblocks, and task blocks' titles.
const writableStop = (x) =>
  x.data?.own && ((x.data.kind === 'block' && x.data.block.kind === 'text' && x.data.block.editable) || (x.data.kind === 'task' && x.data.block));

// The column of place `offset` on a row of text, and the place on a row nearest column `goal`.
const colOf = (row, offset) => row.text.x + (row.text.cols.findLast(([o]) => o <= offset)?.[1] ?? 0);
function offsetAt(row, goal) {
  let best = row.text.cols[0];
  for (const pair of row.text.cols) if (row.text.x + pair[1] <= goal) best = pair;
  return best[0];
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
      // The journal pane shows a day ('day') or a label's boxes ('label'), each where it was left.
      view: 'day',
      day: localDate(),
      label: null,
      labelCount: LABEL_PAGE,
      query: '',
      // What's being typed: { kind, key (the stop it's at), line, target, choice, placeholder }.
      input: null,
      // Writing in a journal: { date, rel, marks, goal }, the day being written in, the cursor as a
      // Yjs relative position, the formatting the next character gets, and the column ↑ and ↓ keep
      // to; or { date, pending } in an empty one, which gets its first paragraph with the first key.
      write: null,
      notice: null,
      help: false,
      undo: null,
      // A task to put the journal's cursor on once its day shows.
      seek: null,
      cursor: { tasks: null, results: null, journal: null, label: null },
      leftWidth: Number.isInteger(saved.leftWidth) ? saved.leftWidth : LEFT.initial,
      openSubtasks: new Set(Array.isArray(saved.openSubtasks) ? saved.openSubtasks : []),
    };
  });
  const s = store.current;
  const calendarRef = useRef(null);
  const scrollRef = useRef({ tasks: 0, results: 0, journal: 0, label: 0 });
  // Where each pane's cursor was, for when what it was on goes away.
  const indexRef = useRef({ tasks: 0, results: 0, journal: 0, label: 0 });
  const noticeTimer = useRef(null);
  const titleTimer = useRef(null);
  const quitting = useRef(false);
  // Which came last, a task deleted from a list or an edit in a journal (and which journal), for
  // u to undo.
  const undoSeq = useRef({ seq: 0, journal: 0, session: null });
  // Images drawn for the journal pane, by file and size: { lines } once drawn, { note } until then
  // or when one can't be.
  const images = useRef(new Map());

  // Layout: the left pane and the journal side by side, or one at a time when narrow.
  const narrow = columns < NARROW;
  const lw = narrow ? columns : clamp(s.leftWidth, LEFT.min, Math.max(LEFT.min, columns - 50));
  const height = screenRows - 1;
  const rw = narrow ? columns : columns - lw - 1;
  const weeks = calendarWeeks(lw - 2);
  const first = calendarStart(calendarRef.current?.weeks === weeks ? calendarRef.current.first : null, s.day, today, weeks);
  calendarRef.current = { first, weeks };

  // Data. Everything is in the copy on this machine, so it's all read on each render.
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
  const byLabel = s.view === 'label';
  const label = byLabel ? pickLabel(labelList, s.label) : null;
  const labelDays = useQuery('labelDays', [label?.id ?? null]);
  const allLabelDays = label ? [...new Set([today, ...labelDays])].sort().reverse() : [];
  const shownLabelDays = allLabelDays.slice(0, s.labelCount);

  // The journals on screen, live: edits here and from other devices show as they're made. By
  // day, the day's and those of the boxes pinned to it; by label, each day shown. And the one
  // being written in, wherever it is.
  const dates = new Set(byLabel ? shownLabelDays : [s.day, ...pins.map((p) => p.date)]);
  if (s.write) dates.add(s.write.date);
  const sessions = useJournals([...dates]);
  const sessionFor = (date) => sessions.get(date);
  const dateOf = (node) => [...sessions].find(([, x]) => x.doc === node.doc)?.[0] ?? null;
  const daySession = sessionFor(s.day);
  const blocks = byLabel ? [] : blocksOf(daySession);
  const pinned = byLabel
    ? []
    : pins.flatMap((pin) => {
        const box = blocksOf(sessionFor(pin.date)).find((b) => b.kind === 'box' && b.id === pin.box);
        return box ? [{ date: pin.date, box }] : [];
      });
  const labelSections = shownLabelDays
    .map((date) => ({ date, boxes: blocksOf(sessionFor(date)).filter((b) => b.kind === 'box' && b.label === label.id) }))
    .filter((d) => d.boxes.length || d.date === today);
  const { groups, named } = useMemo(() => groupTasks(tasks, order), [tasks, order]);

  useEffect(
    () => () => {
      clearTimeout(noticeTimer.current);
      clearTimeout(titleTimer.current);
    },
    [],
  );

  // The journal pane's cursor: its own for each view.
  const rightName = byLabel ? 'label' : 'journal';
  // A block's stop in the journal pane (see dayRows).
  const stopOf = (node) => `blk:${dateOf(node)}:${keyOf(node)}`;

  // The cursor while writing, where it is now; writing stops if what it was in has gone (taken
  // out on another device).
  let caret = null;
  if (s.write) {
    const session = sessionFor(s.write.date);
    if (s.write.pending) caret = session.fragment.length === 0 ? { pending: true } : null;
    else caret = caretFromRel(session.doc, s.write.rel);
    if (!caret) s.write = null;
  }
  // The journal pane's cursor is on what's being written in.
  if (caret) s.cursor = { ...s.cursor, [rightName]: caret.pending ? 'empty' : `blk:${s.write.date}:${keyOf(caret.el)}` };
  else if (s.input?.stop) s.cursor = { ...s.cursor, [rightName]: s.input.stop };

  // --- What the rows need to draw what's being typed.
  const input = s.input;
  const typed = (key, w) =>
    input?.key === key ? inputPieces(input.line, w, { fg: theme.text, faint: theme.faint, placeholder: input.placeholder }) : null;
  const preview = (key) => (input?.key === key ? capturePreview(inputText(input.line), categories, today, theme) : null);
  // The choices a picker or menu being typed in offers.
  const choicesFor = (inp) =>
    ({
      category: () => categoryOptions(inputText(inp.line), categories, inp.target.category),
      label: () => labelOptions(inputText(inp.line), labelList, { none: inp.target.none }),
      labelPick: () => labelOptions(inputText(inp.line), labelList, { create: false }),
      boxMenu: () => boxMenu(inp.target.box, labels.get(inp.target.box.label), pinnedFrom.has(inp.target.box.id)),
      labelMenu: () => labelMenu(inp.target.label),
      labelColor: () => colorOptions(inputText(inp.line)),
      labelDelete: () => [
        { id: 'delete', label: `Delete “${inp.target.label.name}”` },
        { id: 'keep', label: 'Keep it' },
      ],
    })[inp.kind]?.() ?? null;
  const picker = (key, rows, { lead, margin, bg }) => {
    if (input?.key !== key || !['category', 'date', 'label', 'boxMenu', 'labelPick', 'labelMenu', 'labelName', 'labelColor', 'labelDelete'].includes(input.kind)) return;
    const room = (input.pane === 'tasks' ? lw - 2 : rw - 1) - margin - lead.reduce((n, p) => n + p.text.length, 0) - 2;
    const pop = (line, popBg = theme.pop) => rows.push({ line: [...lead, ...fit(line, pw, popBg)], margin, bg, part: key, popup: true });
    const pw = Math.min(['category', 'label', 'labelPick'].includes(input.kind) ? 34 : 46, room);
    const field = (name) => pop([piece(` ${name} `, { fg: theme.muted }), ...inputPieces(input.line, pw - name.length - 3, { fg: theme.text, faint: theme.faint, placeholder: input.placeholder })]);
    const list = (label) => {
      const options = choicesFor(input);
      const choice = clamp(input.choice, 0, options.length - 1);
      const start = clamp(choice - 2, 0, Math.max(0, options.length - 6));
      options.slice(start, start + 6).forEach((o, i) => pop(label(o, start + i === choice), start + i === choice ? theme.accentSoft : theme.pop));
    };
    const plain = (o, chosen) => [piece(` ${o.label}`, { bold: chosen || undefined })];
    const named = (o, chosen) => {
      if (o.isNew) return [piece(' + ', { fg: theme.accent }), piece(o.label, { fg: theme.muted })];
      if (!o.id) return [piece(`   ${o.label}`, { fg: theme.muted })];
      return [piece(' ● ', { fg: theme.label(o.color).text }), piece(o.label, { bold: chosen || undefined })];
    };
    if (input.kind === 'category') {
      field('category');
      list((o, chosen) => (o.isNew ? [piece(' + ', { fg: theme.accent }), piece(o.label, { fg: theme.muted })] : plain(o, chosen)));
      pop([piece(' Enter picks · Esc cancels', { fg: theme.faint })]);
    } else if (input.kind === 'label' || input.kind === 'labelPick') {
      field('label');
      list(named);
      pop([piece(' Enter picks · Esc cancels', { fg: theme.faint })]);
    } else if (input.kind === 'boxMenu' || input.kind === 'labelMenu') {
      list(plain);
      pop([piece(' Enter picks · Esc closes', { fg: theme.faint })]);
    } else if (input.kind === 'labelName') {
      field('name');
      pop([piece(' Enter saves · Esc cancels', { fg: theme.faint })]);
    } else if (input.kind === 'labelColor') {
      field('color');
      list(named);
      pop([piece(' Or type one as #rrggbb · Esc cancels', { fg: theme.faint })]);
    } else if (input.kind === 'labelDelete') {
      const { days } = input.target.label;
      pop([piece(days ? ` Boxes on ${days} ${days === 1 ? 'day' : 'days'} lose this label. Their notes stay.` : ' No boxes have this label.', { fg: theme.muted })]);
      list(plain);
    } else {
      const text = inputText(input.line).trim();
      const due = text ? parseCapture(text).due : null;
      const result = !text ? piece('no due date', { fg: theme.muted }) : due ? piece(shortDay(due, today)) : piece('can’t read a date', { fg: theme.late });
      pop([piece(' due ', { fg: theme.muted }), ...inputPieces(input.line, 16, { fg: theme.text }), piece('  → ', { fg: theme.muted }), result]);
      pop([piece(' Enter sets · Esc cancels', { fg: theme.faint })]);
    }
  };
  // How an image block shows (see day.js), drawn the first time it's asked for at this size.
  const image = (block, w) => {
    if (!block.file) return { note: 'its file is missing' };
    // With 16 colors, there's nothing to draw it in.
    if (theme.level < 2) return {};
    const rows = clamp(Math.floor(height / 2), 4, 16);
    const key = `${block.file}:${w}:${rows}`;
    if (images.current.has(key)) return images.current.get(key);
    const file = replica.queries.file(block.file);
    if (!file) return { note: 'it hasn’t synced to this machine yet' };
    images.current.set(key, { note: 'drawing it…' });
    imageLines(file.bytes, { cols: w, rows, background: theme.bg, level: theme.level })
      .then((lines) => images.current.set(key, { lines }))
      .catch(() => images.current.set(key, { note: 'it can’t be drawn here' }))
      .finally(() => set({}));
    return images.current.get(key);
  };
  const base = {
    theme,
    today,
    typed,
    preview,
    picker,
    image,
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
  const makeJournal = (cursor) => {
    const here = { ...base, w: rw - 1, narrow, cursor: s.pane === 'journal' ? cursor : null, caret };
    if (s.help) return helpRows(s.pane, searching, theme, s.view, rw - 1);
    if (byLabel) return labelRows({ ...here, label, labelList, days: labelSections, more: allLabelDays.length - shownLabelDays.length });
    return dayRows({ ...here, day: s.day, dueTasks, pinned, blocks });
  };
  if (!byLabel) seek('journal', makeJournal);
  const journal = paneModel(rightName, makeJournal);
  scrollRef.current[listName] = scrollTo(list.stop, listHeight, scrollRef.current[listName], list.rows.length);
  // While writing, the line with the cursor stays in view, however long its paragraph.
  let shownStop = journal.stop;
  if (caret && !caret.pending) {
    const row = journal.rows.findLastIndex((r) => r.text?.el === caret.el && r.text.from <= caret.offset);
    if (row >= 0) shownStop = { index: row, end: row + 1 };
  }
  scrollRef.current[rightName] = s.help ? 0 : scrollTo(shownStop, height, scrollRef.current[rightName], journal.rows.length);

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
  const setRightCursor = (key) => set({ cursor: { ...store.current.cursor, [rightName]: key } });
  // Opens a day in the journal pane, By day unless `patch` says otherwise.
  const openDay = (day, patch = {}) => {
    const st = store.current;
    if (day !== st.day) {
      scrollRef.current.journal = 0;
      indexRef.current.journal = 0;
      set({ day, write: st.write?.date === day ? st.write : null, cursor: { ...st.cursor, journal: null }, ...patch });
    } else {
      set(patch);
    }
  };
  // The journal by label, on label `id` (or the one it showed last).
  const showLabel = (id = store.current.label) => {
    const st = store.current;
    if (id !== st.label) {
      scrollRef.current.label = 0;
      indexRef.current.label = 0;
    }
    set({ view: 'label', pane: 'journal', label: id, labelCount: id === st.label ? st.labelCount : LABEL_PAGE, write: null, input: null, cursor: id === st.label ? st.cursor : { ...st.cursor, label: null } });
  };
  const startInput = (inputState, patch = {}) =>
    set({ input: { line: lineInput(''), choice: 0, pane: store.current.pane, ...inputState }, write: null, notice: null, ...patch });
  const startCapture = () =>
    writable() && startInput({ kind: 'capture', key: 'capture', placeholder: 'Add a task: "draft intro fri #paper"' }, { query: '', pane: 'tasks' });
  const setSubtasksOpen = (id, open) => {
    const next = new Set(store.current.openSubtasks);
    if (open) next.add(id);
    else next.delete(id);
    keepState({ openSubtasks: next });
  };

  // --- The journals' documents.
  // Writing in the open day's journal, or in a box shown away from its own (pinned, or by label),
  // where writing stays in the box.
  const boxOnlyIn = (date) => store.current.view === 'label' || date !== store.current.day;
  const editCtx = (session, date) => ({
    newId,
    boxOnly: boxOnlyIn(date),
    resolveLabel: (name) => resolveLabel(name, replica.queries.labels(), (l) => act('createLabel', l)),
    createTask: (id, title, labelId) => {
      session.ensure();
      act('createTaskInNote', session.noteId, title, id, {}, labelId);
    },
  });
  // Runs `fn` as an edit of day `date`'s journal. `alone` makes it a step of its own in the undo
  // history; `tasks` are tasks it deletes along with their block, which undoing it brings back.
  const journalEdit = (date, fn, { alone = false, tasks } = {}) => {
    const session = sessionFor(date);
    if (!session || !writable()) return undefined;
    try {
      const result = alone || tasks ? session.transactAlone(fn, tasks) : session.transact(fn);
      undoSeq.current.journal = ++undoSeq.current.seq;
      undoSeq.current.session = session;
      return result;
    } catch (err) {
      notice(`Couldn’t do that: ${err.message}`, 'warn');
      return undefined;
    }
  };
  // Writing at place `at` ({ el, offset, marks }), in the day its element is in.
  const writeAt = (at, patch = {}) =>
    set({ write: { date: dateOf(at.el), rel: caretToRel(at), marks: at.marks ?? null, goal: null }, input: null, notice: null, ...patch });
  const moveCaret = (at, goal = null) => set({ write: { date: dateOf(at.el), rel: caretToRel(at), marks: null, goal } });
  const browseAt = (node) => set({ write: null, input: null, cursor: { ...store.current.cursor, [rightName]: stopOf(node) } });

  // A task block's title, to type in: at its 'start' or 'end', with `rest` typed after it.
  const startTitle = (taskEl, at = 'end', rest = '') => {
    const id = taskEl.getAttribute('id');
    const task = id ? replica.queries.task(id) : null;
    const stop = stopOf(taskEl);
    if (!task) {
      notice('This task hasn’t synced to this machine yet.');
      return browseAt(taskEl);
    }
    const line = lineInput((task.title ?? '') + rest);
    if (at === 'start') line.pos = 0;
    set({
      write: null,
      input: { kind: 'title', key: `${stop}#title`, stop, line, target: { id, el: taskEl, date: dateOf(taskEl), title: task.title ?? '' }, choice: 0, pane: 'journal' },
      cursor: { ...store.current.cursor, [rightName]: stop },
    });
    if (rest) scheduleTitleSave();
    return undefined;
  };
  const saveTitle = () => {
    clearTimeout(titleTimer.current);
    const st = store.current.input;
    if (st?.kind !== 'title') return;
    const text = inputText(st.line);
    if (text === st.target.title) return;
    st.target.title = text;
    act('updateItem', st.target.id, { title: text });
  };
  const scheduleTitleSave = () => {
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(saveTitle, TITLE_SAVE_MS);
  };

  // Where writing goes after an edit (see journal/edit.js).
  const follow = (result) => {
    if (!result) return undefined;
    if (result.caret) return writeAt(result.caret);
    if (result.task) return startTitle(result.task, result.at, result.rest ?? '');
    if (result.block) return browseAt(result.block);
    return undefined;
  };
  // An edit at the cursor. In an empty journal, it makes the first paragraph to do it in.
  const atCaret = (fn) => {
    const st = store.current.write;
    const session = sessionFor(st.date);
    return follow(
      journalEdit(st.date, () => {
        const at = st.pending ? { el: newParagraph(session.fragment, 0), offset: 0 } : caretFromRel(session.doc, st.rel);
        return at ? fn({ ...at, marks: st.marks ?? undefined }, editCtx(session, st.date)) : null;
      }),
    );
  };

  // To the next place to write before (-1) or after (1) the stop `fromKey`: a textblock's end or
  // start ('end', 'start'), or for ↑ and ↓ ('line') the place on its nearest line nearest column
  // `goal`; or a task's title.
  const toNeighbor = (fromKey, dir, where, goal = 0) => {
    const { stops, rows } = journal;
    const i = stops.findIndex((x) => x.key === fromKey);
    if (i < 0) return undefined;
    for (let j = i + dir; j >= 0 && j < stops.length; j += dir) {
      const x = stops[j];
      if (!writableStop(x)) continue;
      if (x.data.kind === 'task') return startTitle(x.data.block.el, dir < 0 ? 'end' : 'start');
      const { el } = x.data.block;
      if (where === 'end') return moveCaret({ el, offset: textLength(el) });
      if (where === 'start') return moveCaret({ el, offset: 0 });
      const lines = rows.filter((r) => r.text?.el === el);
      const row = dir < 0 ? lines.at(-1) : lines[0];
      return moveCaret({ el, offset: row ? offsetAt(row, goal) : 0 }, goal);
    }
    return undefined;
  };

  // A line up or down from the cursor, keeping to its column.
  const lineMove = (at, dir) => {
    const mine = journal.rows.filter((r) => r.text?.el === at.el);
    const current = mine.findLastIndex((r) => r.text.from <= at.offset);
    if (current < 0) return undefined;
    const goal = store.current.write.goal ?? colOf(mine[current], at.offset);
    const next = mine[current + dir];
    if (next) return moveCaret({ el: at.el, offset: offsetAt(next, goal) }, goal);
    return toNeighbor(stopOf(at.el), dir, 'line', goal);
  };

  // Keys while writing in a textblock.
  const writeKey = (ch, key) => {
    const st = store.current;
    if (key.escape) {
      sessionFor(st.write.date)?.stopCapturing();
      return set({ write: null });
    }
    if (key.ctrl && ch === 'k') return startCapture();
    if (key.ctrl && ch === 's') {
      replica.sync();
      return notice('Syncing…');
    }
    if (key.return) return atCaret((at, ctx) => edits.enter(ctx, at));
    if ((key.meta && key.backspace) || (key.ctrl && ch === 'w')) return atCaret((at, ctx) => edits.deleteBack(ctx, at, edits.wordBack(at.el, at.offset)));
    if (key.ctrl && ch === 'u') return atCaret((at, ctx) => edits.deleteBack(ctx, at, 0));
    if (key.backspace) return atCaret((at, ctx) => edits.backspace(ctx, at));
    if (key.delete || (key.ctrl && ch === 'd')) return atCaret((at, ctx) => edits.deleteAhead(ctx, at));
    if (key.meta && (key.upArrow || key.downArrow)) {
      return atCaret((at, ctx) => {
        const el = edits.moveBlock(at.el, key.upArrow ? -1 : 1, ctx);
        return el ? { caret: { el, offset: at.offset } } : null;
      });
    }
    const at = st.write.pending ? null : caretFromRel(sessionFor(st.write.date).doc, st.write.rel);
    if (at) {
      const len = textLength(at.el);
      if ((key.meta && key.leftArrow) || (key.meta && ch === 'b')) return moveCaret({ el: at.el, offset: edits.wordBack(at.el, at.offset) });
      if ((key.meta && key.rightArrow) || (key.meta && ch === 'f')) return moveCaret({ el: at.el, offset: edits.wordAhead(at.el, at.offset) });
      if (key.leftArrow) return at.offset > 0 ? moveCaret({ el: at.el, offset: edits.stepBack(at.el, at.offset) }) : toNeighbor(stopOf(at.el), -1, 'end');
      if (key.rightArrow) return at.offset < len ? moveCaret({ el: at.el, offset: edits.stepAhead(at.el, at.offset) }) : toNeighbor(stopOf(at.el), 1, 'start');
      if (key.home || (key.ctrl && ch === 'a')) return moveCaret({ el: at.el, offset: 0 });
      if (key.end || (key.ctrl && ch === 'e')) return moveCaret({ el: at.el, offset: len });
      if (key.upArrow || key.downArrow) return lineMove(at, key.upArrow ? -1 : 1);
    }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return undefined;
    // eslint-disable-next-line no-control-regex
    if (!ch || /[\x00-\x1f\x7f]/.test(ch)) return undefined;
    return atCaret((c, ctx) => edits.type(ctx, c, ch));
  };

  // Keys while typing a task block's title in the journal: Enter adds the next task (or, on an
  // empty one, makes it a paragraph again), Backspace on an empty one deletes it, the arrows go
  // on to the lines around it, and Alt+↑ and Alt+↓ move it, all as in the web's task blocks.
  const titleKey = (ch, key) => {
    const st = store.current.input;
    const { target } = st;
    const { date } = target;
    const ctx = () => editCtx(sessionFor(date), date);
    const text = inputText(st.line);
    if (key.escape) {
      saveTitle();
      return set({ input: null });
    }
    if (key.ctrl && ch === 'k') {
      saveTitle();
      return startCapture();
    }
    if (key.return) {
      saveTitle();
      if (!text.trim()) {
        act('deleteItem', target.id);
        return follow(journalEdit(date, () => ({ caret: { el: edits.paragraphFor(target.el), offset: 0 } })));
      }
      const next = journalEdit(date, () => edits.taskAfter(ctx(), target.el));
      return next ? startTitle(next, 'end') : undefined;
    }
    if (key.backspace && !text) {
      const ids = act('deleteTask', target.id);
      if (!ids) return undefined;
      // The cursor goes to the end of what's before it.
      const before = journal.stops.slice(0, journal.stops.findIndex((x) => x.key === st.stop)).findLast(writableStop);
      journalEdit(date, () => edits.removeBlock(target.el), { tasks: ids });
      set({ input: null });
      if (!before) return undefined;
      if (before.data.kind === 'task') return startTitle(before.data.block.el, 'end');
      return moveCaret({ el: before.data.block.el, offset: textLength(before.data.block.el) });
    }
    if (key.meta && (key.upArrow || key.downArrow)) {
      saveTitle();
      const moved = journalEdit(date, () => edits.moveBlock(target.el, key.upArrow ? -1 : 1, ctx()));
      if (!moved) return undefined;
      startTitle(moved, 'end');
      return set((now) => ({ input: { ...now.input, line: { ...now.input.line, pos: st.line.pos } } }));
    }
    const leaving = key.upArrow || key.downArrow || (key.leftArrow && st.line.pos === 0) || (key.rightArrow && st.line.pos === st.line.chars.length);
    if (leaving && !key.meta) {
      saveTitle();
      set({ input: null });
      const dir = key.upArrow || key.leftArrow ? -1 : 1;
      if (key.leftArrow || key.rightArrow) return toNeighbor(st.stop, dir, dir < 0 ? 'end' : 'start');
      // The title starts after the box's bar and the task's box: about that far in.
      return toNeighbor(st.stop, dir, 'line', 5 + (isBox(target.el.parent) ? 2 : 0) + st.line.pos);
    }
    const next = editLine(st.line, ch, key);
    if (!next) return undefined;
    set({ input: { ...st, line: next } });
    if (inputText(next) !== text) scheduleTitleSave();
    return undefined;
  };

  // A new box's label picker, at stop `key`, for a box in day `date`'s journal after top-level
  // block `after` (at the end with null).
  const newBox = (key, date, after) =>
    startInput({ kind: 'label', key, target: { date, after, none: true }, placeholder: 'Find or create a label' });

  // Keys on a block of a journal while browsing. Returns true when it took the key.
  const blockKey = (ch, key, stop) => {
    const { data } = stop;
    if (data.kind === 'empty') {
      if (!key.return && !(ch && 'ioOn'.includes(ch))) return false;
      if (writable()) {
        if (ch === 'n') newBox('empty', data.date, null);
        else set({ write: { date: data.date, pending: true } });
      }
      return true;
    }
    if (data.kind === 'addBox') {
      if (!key.return && !(ch && 'nio'.includes(ch))) return false;
      if (!writable()) return true;
      if (ch !== 'o') return newBox('add-box', s.day, null) ?? true;
      const { fragment } = daySession;
      const last = fragment.toArray().at(-1);
      if (isElement(last, 'paragraph') && textLength(last) === 0) return writeAt({ el: last, offset: 0 }) ?? true;
      const p = journalEdit(s.day, () => newParagraph(fragment, fragment.length));
      return (p && writeAt({ el: p, offset: 0 })) ?? true;
    }
    const block = data.kind === 'boxHeader' ? data.box : data.block;
    if (!data.own || !block?.el) return false;
    const { el } = block;
    const { date } = data;
    // Keys for any block, and for a box from its label line.
    if (ch === 'o' || ch === 'O') {
      const p = journalEdit(date, () => edits.lineBeside(el, ch === 'o'));
      return (p && writeAt({ el: p, offset: 0 })) ?? true;
    }
    if (ch === 'n') {
      if (data.boxOnly) notice('A notes box goes in a day’s journal: open the day with Enter on its date, or + Add to today.');
      else if (writable()) newBox(stop.key, date, topOf(el));
      return true;
    }
    if (key.meta && (key.upArrow || key.downArrow)) {
      const moved = journalEdit(date, () => edits.moveBlock(el, key.upArrow ? -1 : 1, { boxOnly: data.boxOnly }));
      if (moved) browseAt(moved);
      return true;
    }
    if (ch === 'D') {
      if (!writable()) return true;
      if (block.kind === 'task') {
        const ids = block.id ? act('deleteTask', block.id) : [];
        if (!ids) return true;
        journalEdit(date, () => edits.removeBlock(el), { tasks: ids.length ? ids : undefined, alone: true });
        const name = (block.id && replica.queries.task(block.id)?.title) || 'the task';
        return notice(`Deleted ${name === 'the task' ? name : `“${name}”`}. u brings it back.`);
      }
      journalEdit(date, () => edits.removeBlock(el), { alone: true });
      return notice(`Deleted the ${block.kind === 'box' ? 'box and its notes' : 'block'}. u brings it back.`);
    }
    if (data.kind === 'boxHeader') {
      if (!key.return) return false;
      startInput({ kind: 'boxMenu', key: stop.key, target: { box: block, date } });
      return true;
    }
    if (!key.return && ch !== 'i') return false;
    if (block.kind === 'image') showImage(block);
    else if (block.kind === 'text' && !block.editable) notice('This version can’t write in this block. Update Almanac to edit it.');
    else if (!writable() || block.kind === 'rule') return true;
    else if (block.kind === 'task') startTitle(el, 'end');
    else if (block.kind === 'math') startInput({ kind: 'latex', key: `${stop.key}#latex`, stop: stop.key, line: lineInput(block.latex), target: { el, date } });
    else writeAt({ el, offset: textLength(el) });
    return true;
  };

  // Keys in the journal by label, before those for the block under the cursor. Returns true when
  // it took the key.
  const labelKey = (ch, key, stop) => {
    const st = store.current;
    const kind = stop?.data?.kind;
    if (ch === '[' || ch === ']') {
      const at = labelList.findIndex((l) => l.id === label?.id) + (ch === '[' ? -1 : 1);
      if (labelList[at]) showLabel(labelList[at].id);
      return true;
    }
    if (ch === 'L') {
      if (labelList.length) startInput({ kind: 'labelPick', key: 'label-head', placeholder: 'Find a label' }, { cursor: { ...st.cursor, label: 'label-head' } });
      return true;
    }
    if (!label) return false;
    if (ch === 'e' || (kind === 'labelHead' && key.return)) {
      if (writable()) startInput({ kind: 'labelMenu', key: 'label-head', target: { label } }, { cursor: { ...st.cursor, label: 'label-head' } });
      return true;
    }
    if (kind === 'labelDay' && key.return) {
      openDay(stop.data.date, { view: 'day', pane: 'journal' });
      return true;
    }
    if (kind === 'labelAdd' && (key.return || ch === 'i' || ch === 'o')) {
      // A box under the label at the end of today's journal, in place of an empty last line.
      const p = journalEdit(stop.data.date, () => insertBox(sessionFor(stop.data.date).fragment, null, { id: newId(), label: label.id }), { alone: true });
      if (p) writeAt({ el: p, offset: 0 });
      return true;
    }
    if (kind === 'labelMore' && key.return) {
      set({ labelCount: st.labelCount + LABEL_PAGE });
      return true;
    }
    return false;
  };

  // What's picked in a box's label picker: put on the box, or a new box under it.
  const pickBoxLabel = () => {
    const st = store.current.input;
    const text = inputText(st.line).trim();
    const options = choicesFor(st);
    const option = options[clamp(st.choice, 0, options.length - 1)];
    const create = (l) => act('createLabel', l);
    const id = option ? (option.create ? resolveLabel(option.create, replica.queries.labels(), create) : option.id) : resolveLabel(text, replica.queries.labels(), create);
    const { date } = st.target;
    if (st.target.box) {
      const { el } = st.target.box;
      journalEdit(date, () => (id ? el.setAttribute('label', id) : el.removeAttribute('label')), { alone: true });
      return set({ input: null });
    }
    const p = journalEdit(date, () => insertBox(sessionFor(date).fragment, st.target.after, { id: newId(), label: id }), { alone: true });
    return p ? writeAt({ el: p, offset: 0 }) : set({ input: null });
  };

  const pickFromBoxMenu = () => {
    const st = store.current;
    const { box, date } = st.input.target;
    const options = choicesFor(st.input);
    const option = options[clamp(st.input.choice, 0, options.length - 1)];
    if (option.id === 'label') {
      return set({ input: { ...st.input, kind: 'label', line: lineInput(''), choice: 0, target: { box, date, none: Boolean(box.label) }, placeholder: 'Find or create a label' } });
    }
    if (option.id === 'editLabel') return set({ input: { ...st.input, kind: 'labelMenu', choice: 0, target: { label: labels.get(box.label) } } });
    set({ input: null });
    if (option.id === 'byLabel') return showLabel(box.label);
    if (option.id === 'pin') return togglePin(box);
    if (option.id === 'unwrap') {
      const firstBlock = journalEdit(date, () => unwrapBox(box.el), { alone: true });
      return firstBlock ? browseAt(firstBlock) : undefined;
    }
    journalEdit(date, () => edits.removeBlock(box.el), { alone: true });
    return notice('Deleted the box and its notes. u brings them back.');
  };

  // A label's menu, rename, recolor and delete, as the web's label editor does them: for every
  // box with the label at once.
  const labelPicked = () => {
    const st = store.current.input;
    const options = choicesFor(st);
    const option = options?.[clamp(st.choice, 0, options.length - 1)];
    const target = st.target?.label;
    const text = inputText(st.line).trim();
    if (st.kind === 'labelPick') {
      if (option) showLabel(option.id);
      return undefined;
    }
    if (st.kind === 'labelMenu') {
      if (option.id === 'rename') return set({ input: { ...st, kind: 'labelName', line: lineInput(target.name), choice: 0 } });
      if (option.id === 'color') return set({ input: { ...st, kind: 'labelColor', line: lineInput(''), choice: Math.max(0, LABEL_COLORS.indexOf(target.color)) } });
      return set({ input: { ...st, kind: 'labelDelete', choice: 1 } });
    }
    if (st.kind === 'labelName') {
      if (!text || text === target.name) return set({ input: null });
      if (labelList.some((l) => l.id !== target.id && sameLabel(l.name, text))) return notice(`Another label is called “${text}”.`, 'warn');
      act('updateItem', target.id, { title: text });
      set({ input: null });
      return notice(`Renamed it “${text}”, on every box with it.`);
    }
    if (st.kind === 'labelColor') {
      if (!option) return notice('Pick a color, or type one as #rrggbb.', 'warn');
      act('setLabelColor', target.id, option.id);
      return set({ input: null });
    }
    set({ input: null });
    if (option.id !== 'delete') return undefined;
    act('deleteItem', target.id);
    if (store.current.view === 'label') set({ label: null, cursor: { ...store.current.cursor, label: null } });
    return notice(`Deleted “${target.name}”. Its boxes keep their notes.`);
  };

  // Opens an image in the system's viewer, or says where it's saved when there's no display.
  const showImage = (block) => {
    const file = block.file ? replica.queries.file(block.file) : null;
    if (!file) return notice('This image hasn’t synced to this machine yet.');
    try {
      const { saved, opened } = openImage(file, block.file, paths.images);
      const where = saved.startsWith(os.homedir()) ? `~${saved.slice(os.homedir().length)}` : saved;
      return notice(opened ? `Opened ${block.alt ? `“${block.alt}”` : 'it'} in your image viewer.` : `No display to open it on here; it’s saved as ${where}`);
    } catch (err) {
      return notice(`Couldn’t open it: ${err.message}`, 'warn');
    }
  };

  const togglePin = (box) => {
    if (!box.id) return notice('This box is older than pinning: pin it on the web once, and it can be pinned here after.');
    if (!writable()) return undefined;
    const st = store.current;
    if (pinnedFrom.has(box.id)) {
      act('unpinBox', st.day, box.id, st.day);
      return notice('Unpinned. It no longer shows on the days after this one.');
    }
    act('pinBox', st.day, box.id);
    return notice('Pinned. It shows on each day after this one until it’s unpinned.');
  };

  const quit = async () => {
    if (quitting.current) return;
    quitting.current = true;
    // What's still waiting to be saved, so the last sync sends it.
    saveTitle();
    replica.bodies.flushAll();
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
    const { task, parent } = stop.data;
    const sub = stop.data.kind === 'subtask';
    const name = task.title || 'Untitled task';
    if (task.missing) return key.return || (ch && 'xrcdsAD '.includes(ch)) ? notice('This task hasn’t synced to this machine yet.') : undefined;
    if (ch === 'x' || ch === ' ') return writable() && act('setTaskStatus', task.id, task.status === 'open' ? 'done' : 'open');
    if (ch === 'r') return writable() && startInput({ kind: 'rename', key: `${stop.key}#title`, line: lineInput(task.title ?? ''), target: task });
    if (key.return) {
      const day = replica.queries.taskDay((sub ? parent : task).id);
      if (!day) return notice(`“${name}” isn’t written in a journal or due on a day.`);
      return openDay(day, { view: 'day', pane: 'journal', seek: (sub ? parent : task).id });
    }
    if (ch === 'D') {
      if (!writable()) return undefined;
      const ids = sub ? (act('deleteItem', task.id), [task.id]) : act('deleteTask', task.id);
      if (!ids) return undefined;
      set({ undo: { ids, name, seq: ++undoSeq.current.seq } });
      return notice(`Deleted “${name}”${ids.length > 1 ? ' and its subtasks' : ''}. u brings ${ids.length > 1 ? 'them' : 'it'} back.`);
    }
    if (key.meta && (key.upArrow || key.downArrow)) {
      if (store.current.pane !== 'tasks' || sub) return undefined;
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
      const pane = store.current.pane === 'tasks' ? listName : rightName;
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
        return notice(err.message, 'warn');
      }
    }
    if (kind === 'search') return close({ pane: 'tasks' });
    if (kind === 'goto') {
      if (!text) return close();
      const day = readDate(text);
      if (!day) return notice(`Couldn’t read a date in “${text}”.`, 'warn');
      return openDay(day, { input: null, view: 'day' });
    }
    if (kind === 'rename') {
      if (text !== (target.title ?? '')) act('updateItem', target.id, { title: text });
      return close();
    }
    if (kind === 'category') {
      const options = choicesFor(st.input);
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
    if (kind === 'latex') {
      // An equation left empty goes, as on the web.
      journalEdit(target.date, () => (text ? target.el.setAttribute('latex', text) : edits.removeBlock(target.el)), { alone: true });
      return close();
    }
    if (kind === 'label') return pickBoxLabel();
    if (kind === 'boxMenu') return pickFromBoxMenu();
    if (kind.startsWith('label')) return labelPicked();
    return close();
  };

  const inputKey = (ch, key) => {
    const st = store.current;
    const { kind } = st.input;
    if (kind === 'title') return titleKey(ch, key);
    if (key.escape) return set(kind === 'search' ? { input: null, query: '' } : { input: null });
    if (key.return) return submitInput();
    if (kind === 'search' && (key.tab || key.downArrow)) return set({ input: null, pane: 'tasks' });
    const choices = choicesFor(st.input);
    if (choices && (key.upArrow || key.downArrow)) {
      return set({ input: { ...st.input, choice: clamp(st.input.choice + (key.upArrow ? -1 : 1), 0, choices.length - 1) } });
    }
    // Menus have nothing to type.
    if (['boxMenu', 'labelMenu', 'labelDelete'].includes(kind)) return undefined;
    const next = editLine(st.input.line, ch, key);
    if (!next) return undefined;
    const changed = inputText(next) !== inputText(st.input.line);
    return set({
      input: { ...st.input, line: next, choice: choices && changed ? 0 : st.input.choice },
      ...(kind === 'search' ? { query: inputText(next) } : {}),
    });
  };

  // The cursor's pane, its model and the rows a page holds.
  const focusedList = () => {
    const st = store.current;
    if (st.pane === 'journal') return { name: rightName, model: journal, page: height };
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
    // By label, reaching the end shows older days.
    const more = stops[next].key === 'label-more' ? { labelCount: store.current.labelCount + LABEL_PAGE } : {};
    set({ cursor: { ...store.current.cursor, [name]: stops[next].key }, ...more });
  };

  const handleKey = (ch, key) => {
    const st = store.current;
    if (key.ctrl && ch === 'c') return quit();
    if (st.help) return set({ help: false });
    if (st.input) return inputKey(ch, key);
    if (st.write) return writeKey(ch, key);
    if (st.notice) set({ notice: null });

    // Everywhere.
    if (key.tab) return set({ pane: PANES[(PANES.indexOf(st.pane) + (key.shift ? -1 : 1) + PANES.length) % PANES.length] });
    if ((key.ctrl && ch === 'k') || ch === 'a') return startCapture();
    if (ch === '/') return startInput({ kind: 'search', key: 'search', line: lineInput(st.query), placeholder: 'Search' }, { pane: 'tasks' });
    const stopHere = focusedList()?.model.stop;
    if (st.view === 'label' && st.pane === 'journal' && labelKey(ch, key, stopHere)) return undefined;
    if (ch === '[' || ch === ']') return openDay(addDays(st.day, ch === '[' ? -1 : 1));
    if (ch === 't') return openDay(today, { view: 'day' });
    if (ch === 'g') return startInput({ kind: 'goto', key: 'goto', placeholder: 'fri, oct 3, 2025-12-24' });
    if (ch === '<' || ch === '>') return keepState({ leftWidth: clamp(lw + (ch === '<' ? -2 : 2), LEFT.min, Math.max(LEFT.min, columns - 50)) });
    if (key.ctrl && ch === 's') {
      replica.sync();
      return notice(replica.status.readOnly ? new ReadOnlyError().message : 'Syncing…');
    }
    if (ch === 'q') return quit();
    if (ch === '?') return set({ help: true });
    // v switches views. By day it goes to the label of the box under the cursor, if it's in one.
    if (ch === 'v') {
      if (st.view === 'label') return set({ view: 'day', write: null });
      const node = stopHere?.data?.block?.el ?? stopHere?.data?.box?.el;
      const box = st.pane === 'journal' && node ? boxOf(node) : null;
      return showLabel(box?.getAttribute('label') ?? st.label);
    }
    // In the journal, u and Ctrl+R undo and redo its edits; u also brings back a task deleted
    // from a list, if that came last.
    const lastEdited = undoSeq.current.session;
    if (key.ctrl && ch === 'r') {
      if (st.pane !== 'journal' || !writable()) return undefined;
      return lastEdited?.redo() ? undefined : notice('Nothing to redo.');
    }
    if (ch === 'u') {
      const taskLast = st.undo && st.undo.seq > undoSeq.current.journal;
      if (st.pane === 'journal' && !taskLast) {
        if (!writable()) return undefined;
        if (lastEdited?.undo()) return undefined;
        if (!st.undo) return notice('Nothing to undo.');
      }
      if (!st.undo) return notice('Nothing to bring back.');
      if (!writable()) return undefined;
      act('restoreItems', st.undo.ids);
      set({ undo: null });
      return notice(`Brought back “${st.undo.name}”.`);
    }
    if (key.escape && st.query) return set({ query: '' });
    // When narrow, Esc puts the journal back over the calendar and tasks.
    if (key.escape && narrow && st.pane !== 'journal') return set({ pane: 'journal' });

    if (st.pane === 'calendar') {
      const step = key.leftArrow || ch === 'h' ? -7 : key.rightArrow || ch === 'l' ? 7 : key.upArrow || ch === 'k' ? -1 : key.downArrow || ch === 'j' ? 1 : 0;
      if (step) return openDay(addDays(st.day, step));
      if (key.return) return set({ pane: 'journal', view: 'day' });
      return undefined;
    }

    const target = focusedList();
    const stop = target.model.stop;
    const data = stop?.data;
    if (st.pane === 'journal' && stop && blockKey(ch, key, stop) !== false) return undefined;
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
    if (data.kind === 'result' && key.return) return openDay(data.date, { pane: 'journal', view: 'day' });
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
    if (data.kind === 'boxHeader' && ch === 'p') return togglePin(data.box);
    return undefined;
  };

  useInput(handleKey);
  usePaste((text) => {
    const st = store.current;
    if (st.write) return void atCaret((at, ctx) => edits.paste(ctx, at, text));
    if (!st.input || ['boxMenu', 'labelMenu', 'labelDelete'].includes(st.input.kind)) return;
    const line = insertText(st.input.line, text);
    set({ input: { ...st.input, line }, ...(st.input.kind === 'search' ? { query: inputText(line) } : {}) });
    if (st.input.kind === 'title') scheduleTitleSave();
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
  // The calendar, showing search results' days while there's a search, and a label's days by
  // label, in its color.
  const labelColors = label ? theme.label(label.color) : null;
  const matches = searching ? new Set(results.map((r) => r.date)) : label ? new Set(labelDays) : null;
  const matchColor = searching || !label ? theme.match : labelColors.text;
  calendarLines({ first, weeks, day: s.day, today, counts, matches, matchColor, theme }).forEach((line, i) =>
    leftLine(line, { mark: s.pane === 'calendar' && i === weekday(s.day) + 1 }),
  );
  leftLine([]);
  if (label && !searching) {
    leftLine([piece(`● ${label.name}`, { fg: labelColors.text }), piece(` · ${labelUse(label, today)}`, { fg: theme.muted })]);
  } else {
    const dayName = s.day === today ? 'Today' : s.day === addDays(today, -1) ? 'Yesterday' : s.day === addDays(today, 1) ? 'Tomorrow' : shortDay(s.day, today);
    const described = describeDay(dayName, counts[s.day]);
    leftLine([piece(described.name), piece(described.rest, { fg: theme.muted })]);
  }
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

  const right = paneLines(journal.rows, { w: rw, height, top: scrollRef.current[rightName], stop: journal.stop, focused: s.pane === 'journal' && !s.help, theme });
  const lines = [];
  for (let y = 0; y < height; y++) {
    const leftOne = left[y] ?? [piece(' '.repeat(lw))];
    if (!narrow) lines.push([...leftOne, piece('│', { fg: theme.line }), ...right[y]]);
    else lines.push(s.pane === 'journal' ? right[y] : leftOne);
  }

  // The status bar.
  const writing = Boolean(s.write) || input?.kind === 'title';
  const paneMode = s.pane === 'journal' && byLabel ? 'LABEL' : PANE_MODES[s.pane] === 'TASKS' && searching ? 'SEARCH' : PANE_MODES[s.pane];
  const mode = s.write ? 'WRITE' : input ? INPUT_MODES[input.kind] : s.help ? 'KEYS' : paneMode;
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
      typingMode: Boolean(input) || writing,
      hints: hintsFor(s, input, (s.pane === 'journal' ? journal : list).stop, searching, narrow),
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
function hintsFor(s, input, stop, searching, narrow) {
  const writing = [['Esc', 'stop'], ['Enter', 'new line'], ['Alt+↑↓', 'move'], ['Ctrl+K', 'add task']];
  if (s.write) return writing;
  if (input) {
    const choose = [['↑↓', 'choose'], ['Enter', 'pick'], ['Esc', 'cancel']];
    return {
      capture: [['Enter', 'add'], ['Esc', 'done']],
      dueAdd: [['Enter', 'add'], ['Esc', 'done']],
      search: [['Enter', 'see the days'], ['Esc', 'clear']],
      rename: [['Enter', 'save'], ['Esc', 'cancel']],
      category: choose,
      date: [['Enter', 'set'], ['Esc', 'cancel']],
      subtask: [['Enter', 'add'], ['Esc', 'done']],
      goto: [['Enter', 'go'], ['Esc', 'cancel']],
      title: [['Esc', 'stop'], ['Enter', 'next task'], ['Alt+↑↓', 'move'], ['Ctrl+K', 'add task']],
      latex: [['Enter', 'save'], ['Esc', 'cancel']],
      label: choose,
      boxMenu: [['↑↓', 'choose'], ['Enter', 'pick'], ['Esc', 'close']],
      labelPick: choose,
      labelMenu: [['↑↓', 'choose'], ['Enter', 'pick'], ['Esc', 'close']],
      labelName: [['Enter', 'save'], ['Esc', 'cancel']],
      labelColor: choose,
      labelDelete: choose,
    }[input.kind];
  }
  if (s.help) return [['any key', 'close']];
  // When narrow, Tab is how to reach what's hidden.
  const keys = narrow ? [['Tab', s.pane === 'journal' ? 'calendar' : 'journal'], ['?', 'keys']] : [['?', 'keys']];
  if (s.pane === 'calendar') return [['←→', 'week'], ['↑↓', 'day'], ['Enter', 'journal'], ['Tab', 'pane'], ...keys];
  const { kind, own, block, boxOnly } = stop?.data ?? {};
  const labelKeys = s.view === 'label' && s.pane === 'journal' ? [['[ ]', 'label'], ['e', 'edit label']] : [];
  if (kind === 'labelHead') return [['Enter', 'edit label'], ['[ ]', 'label'], ['L', 'pick label'], ['v', 'by day'], ...keys];
  if (kind === 'labelDay') return [['Enter', 'open day'], ['[ ]', 'label'], ['L', 'pick label'], ['e', 'edit label'], ['i', 'write'], ...keys];
  if (kind === 'labelAdd') return [['Enter', 'add a box today'], ['[ ]', 'label'], ['L', 'pick label'], ...keys];
  if (kind === 'labelMore') return [['Enter', 'older days'], ...keys];
  if (kind === 'task' && own) return [['x', 'done'], ['c', 'category'], ['d', 'date'], ['s', 'subtasks'], ['Alt+↑↓', 'move'], ['i', 'write'], ...labelKeys, ...keys];
  if (kind === 'task') {
    const move = s.pane === 'tasks' ? [['Alt+↑↓', 'move']] : [];
    return [['x', 'done'], ['c', 'category'], ['d', 'date'], ['s', 'subtasks'], ...move, ['Enter', 'its day'], ...keys];
  }
  if (kind === 'subtask') return [['x', 'done'], ['r', 'rename'], ['D', 'delete'], ...keys];
  if (kind === 'category') return [['Alt+↑↓', 'move category'], ['j k', 'move'], ...keys];
  if (kind === 'result') return [['Enter', 'open day'], ['j k', 'move'], ['Esc', 'clear'], ...keys];
  if (kind === 'addSubtask' || kind === 'dueAdd') return [['Enter', 'add a task'], ...keys];
  if (kind === 'pinHeader') return [['Enter', 'its day'], ['p', 'unpin'], ...keys];
  if (kind === 'boxHeader') return [['Enter', 'box'], ['p', 'pin'], ['o', 'write in it'], ['Alt+↑↓', 'move'], ['D', 'delete'], ['v', 'by label'], ...keys];
  if (kind === 'empty') return [['i', 'write'], ['n', 'notes box'], ['[ ]', 'day'], ...keys];
  if (kind === 'addBox') return [['Enter', 'add a notes box'], ['o', 'new line'], ...keys];
  if (kind === 'block' && own) {
    const write = block.kind === 'text' || block.kind === 'math' ? [['i', 'write']] : block.kind === 'image' ? [['Enter', 'open']] : [];
    const box = boxOnly ? [] : [['n', 'notes box']];
    return [...write, ['o', 'new line'], ...box, ['Alt+↑↓', 'move'], ['D', 'delete'], ['u', 'undo'], ...labelKeys, ...keys];
  }
  if (searching && s.pane === 'tasks') return [['Esc', 'clear'], ...keys];
  return [['j k', 'move'], ['[ ]', 'day'], ['t', 'today'], ['a', 'add task'], ['v', 'by label'], ...keys];
}
