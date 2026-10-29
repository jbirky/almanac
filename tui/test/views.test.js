import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BODY_FIELD, addDays, relativeDay } from '@almanac/shared';
import { readJournal } from '../src/journal/layout.js';
import { lineWidth, width } from '../src/text.js';
import { makeTheme } from '../src/theme.js';
import { calendarLines, calendarStart, calendarWeeks, weekStart } from '../src/views/calendar.js';
import { findStop, paneLines, scrollTo, stopsOf } from '../src/views/pane.js';
import { DATE_SLOT, taskLine } from '../src/views/rows.js';
import { statusLine } from '../src/views/status.js';
import { groupTasks } from '../src/views/tasks.js';
import { blocks } from './helpers.js';

const theme = makeTheme();
const today = '2026-10-28';
const text = (line) => line.map((p) => p.text).join('');
const task = (title, extra = {}) => ({ id: title, title, status: 'open', due: null, category: null, subtasks: 0, subtasks_done: 0, ...extra });

describe('a task’s line', () => {
  const list = [
    task('referee report', { due: addDays(today, -2), category: 'paper' }),
    task('read new TESS paper', { due: addDays(today, 1), category: 'paper', subtasks: 2, subtasks_done: 1 }),
    task('submit abstract', { category: 'paper' }),
    task('a title long enough that it has to be cut to fit the line', { due: addDays(today, 30), category: 'paper' }),
  ];

  it('is exactly as wide as asked, cutting the title rather than the date or chip', () => {
    for (const t of list) expect(lineWidth(taskLine(t, { w: 60, theme, today }))).toBe(60);
    const long = text(taskLine(list[3], { w: 60, theme, today }));
    expect(long).toContain('…');
    expect(long.trimEnd().endsWith(relativeDay(list[3].due, today))).toBe(true);
  });

  it('lines up categories and due dates down a list, the dates against the right edge', () => {
    const lines = list.map((t) => text(taskLine(t, { w: 60, theme, today })));
    // The last " paper " is the chip: one title has the word in it too.
    const chipEnds = lines.map((l) => width(l.slice(0, l.lastIndexOf(' paper ') + ' paper '.length)));
    expect(new Set(chipEnds).size).toBe(1);
    expect(chipEnds[0]).toBe(60 - DATE_SLOT - 2);
    expect(lines[0].endsWith(relativeDay(list[0].due, today))).toBe(true);
    expect(lines[1]).toMatch(/1\/2 {2} paper .*Tomorrow$/);
  });

  it('in a list grouped by category, shows the category only on the cursor’s line', () => {
    expect(text(taskLine(list[0], { w: 60, theme, today, quietCategory: true }))).not.toContain('paper');
    expect(text(taskLine(list[0], { w: 60, theme, today, quietCategory: true, cursor: true }))).toContain(' paper ');
  });

  it('leaves out a due date that is the day being shown, except on the cursor’s line', () => {
    const due = task('call the observatory', { due: today });
    expect(text(taskLine(due, { w: 50, theme, today, day: today }))).not.toContain('Today');
    expect(text(taskLine(due, { w: 50, theme, today, day: today, cursor: true }))).toContain('Today');
  });

  it('checks off a finished task and drops its date', () => {
    const line = taskLine(task('tidy the desk', { status: 'done', due: today }), { w: 40, theme, today });
    expect(text(line)).toMatch(/^\[x\] tidy the desk\s*$/);
    expect(line.find((p) => p.text === 'tidy the desk')).toMatchObject({ strike: true });
  });
});

describe('the calendar', () => {
  const weeks = 20;
  const first = calendarStart(null, today, today, weeks);

  it('starts with four weeks after today’s in view, and moves only to keep the open day in view', () => {
    expect(first).toBe(addDays(weekStart(today), -7 * (weeks - 5)));
    expect(calendarStart(first, addDays(first, 3), today, weeks)).toBe(first);
    expect(calendarStart(first, addDays(first, -1), today, weeks)).toBe(addDays(first, -7));
    expect(calendarStart(first, addDays(first, 7 * weeks), today, weeks)).toBe(addDays(first, 7));
  });

  it('fits as many weeks as the pane is wide, two columns a day', () => {
    expect(calendarWeeks(43)).toBe(20);
    expect(calendarWeeks(10)).toBe(4);
  });

  it('draws a line of months and one per weekday, each day as a shaded square', () => {
    const counts = { [addDays(today, -1)]: { done: 3, words: 40, due: 1 }, [addDays(today, -2)]: { done: 0, words: 12, due: 0 } };
    const lines = calendarLines({ first, weeks, day: today, today, counts, matches: null, theme });
    expect(lines).toHaveLength(8);
    expect(text(lines[0])).toMatch(/Sep.*Oct.*Nov/);
    for (const line of lines.slice(1)) expect(lineWidth(line)).toBe(2 + 2 * weeks);
    const cell = (date) => {
      const line = lines[1 + new Date(`${date}T12:00`).getDay()];
      const week = Math.round((new Date(`${weekStart(date)}T12:00`) - new Date(`${first}T12:00`)) / (7 * 864e5));
      return text(line).slice(2 + 2 * week, 4 + 2 * week);
    };
    // Written in, with tasks done and one due; written in only; today; a day ahead.
    expect(cell(addDays(today, -1))).toBe('▣•');
    expect(cell(addDays(today, -2))).toBe('▣ ');
    expect(cell(addDays(today, 3))).toBe('· ');
    const open = lines.flat().find((p) => p.inverse);
    expect(open.fg).toBe(theme.accent);
  });

  it('shows the days a search matched in its color, and fades the rest', () => {
    const match = addDays(today, -9);
    const lines = calendarLines({ first, weeks, day: today, today, counts: {}, matches: new Set([match]), matchColor: theme.match, theme });
    expect(lines.flat().filter((p) => p.fg === theme.match)).toHaveLength(1);
  });
});

describe('the status bar', () => {
  const hints = [['x', 'done'], ['c', 'category'], ['Enter', 'its day']];
  const status = { readOnly: false, online: true, syncing: false, pending: 0, lastSync: '2026-10-28T21:21:00Z', error: null };

  it('says how sync is going in a few words, and fills the width', () => {
    const cases = [
      [status, /● synced/],
      [{ ...status, pending: 2 }, /◌ syncing/],
      [{ ...status, online: false, pending: 3 }, /○ Offline · 3 waiting/],
      [{ ...status, error: 'Server answered 500' }, /✕ Sync error: Server answered 500/],
    ];
    for (const [s, pattern] of cases) {
      const line = statusLine({ status: s, mode: 'TASKS', hints, notice: null, theme, w: 100 });
      expect(lineWidth(line)).toBe(100);
      expect(text(line)).toMatch(pattern);
    }
  });

  it('keeps read-only short, so the keys still fit beside it', () => {
    const line = text(statusLine({ status: { ...status, readOnly: true }, mode: 'JOURNAL', hints, notice: null, theme, w: 72 }));
    expect(line).toMatch(/◇ read-only {3}JOURNAL {3}x done {2}c category {2}Enter its day/);
  });

  it('shows a notice in place of the keys', () => {
    const line = text(statusLine({ status, mode: 'TASKS', hints, notice: { text: 'Added call the dentist' }, theme, w: 100 }));
    expect(line).toContain('Added call the dentist');
    expect(line).not.toContain('category');
  });
});

describe('a pane’s cursor', () => {
  const rows = [{ stop: 'a' }, { part: 'a' }, {}, { stop: 'b' }, {}, { stop: 'c' }].map((r) => ({ line: [], ...r }));

  it('stops on each row marked as a stop, taking in the rows that belong to it', () => {
    expect(stopsOf(rows).map(({ key, index, end }) => [key, index, end])).toEqual([
      ['a', 0, 2],
      ['b', 3, 4],
      ['c', 5, 6],
    ]);
  });

  it('stays where it was when what it was on goes away', () => {
    const stops = stopsOf(rows);
    expect(findStop(stops, 'b').key).toBe('b');
    expect(findStop(stops, 'gone', 1).key).toBe('b');
    expect(findStop(stops, 'gone', 9).key).toBe('c');
    expect(findStop([], 'gone')).toBeNull();
  });

  it('scrolls only as far as shows the whole stop', () => {
    const [a, b, c] = stopsOf(rows);
    expect(scrollTo(a, 2, 0, rows.length)).toBe(0);
    expect(scrollTo(b, 2, 0, rows.length)).toBe(2);
    expect(scrollTo(c, 2, 0, rows.length)).toBe(4);
    expect(scrollTo(a, 2, 4, rows.length)).toBe(0);
  });

  it('marks the cursor’s rows in the gutter while the pane has focus', () => {
    const [a] = stopsOf(rows);
    const lines = paneLines(rows, { w: 20, height: 8, top: 0, stop: a, focused: true, theme });
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(lineWidth(line)).toBe(20);
    expect(lines.map((l) => l[0].text).join('')).toBe('▌▌      ');
    expect(paneLines(rows, { w: 20, height: 3, top: 0, stop: a, focused: false, theme }).map((l) => l[0].text).join('')).toBe('   ');
  });
});

describe('the task list’s groups', () => {
  it('orders categories as set on any device, then alphabetically, with no category last', () => {
    const tasks = [task('a', { category: 'paper' }), task('b'), task('c', { category: 'zeta' }), task('d', { category: 'observing' }), task('e', { category: 'paper' })];
    const { groups, named } = groupTasks(tasks, ['zeta']);
    expect(named).toEqual(['zeta', 'observing', 'paper']);
    expect(groups.map((g) => [g.name, g.tasks.map((t) => t.title).join('')])).toEqual([
      ['zeta', 'c'],
      ['observing', 'd'],
      ['paper', 'ae'],
      ['', 'b'],
    ]);
  });
});

describe('reading a day’s journal', () => {
  it('reads the blocks TipTap writes, in order, with boxes holding their own', () => {
    const doc = new Y.Doc();
    const body = doc.getXmlFragment(BODY_FIELD);
    // Marks as y-prosemirror stores them: formatting attributes on one text.
    const p = blocks.element(body, 'paragraph');
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, 'Discussed ');
    t.insert(10, 'priors', { italic: {} });
    // Yjs carries formatting on unless it's cleared, as y-prosemirror clears it.
    t.insert(16, ' for the fits.', { italic: null });
    blocks.element(body, 'heading', { level: 2 }, (h) => h.insert(0, [new Y.XmlText('Plan')]));
    blocks.element(body, 'bulletList', {}, (ul) => {
      blocks.element(ul, 'listItem', {}, (li) => blocks.para(li, 'first point'));
      blocks.element(ul, 'listItem', {}, (li) => {
        blocks.para(li, 'second point');
        blocks.element(li, 'bulletList', {}, (inner) => blocks.element(inner, 'listItem', {}, (l) => blocks.para(l, 'nested')));
      });
    });
    blocks.element(body, 'orderedList', { start: 3 }, (ol) => blocks.element(ol, 'listItem', {}, (li) => blocks.para(li, 'third')));
    blocks.task(body, 'task-1');
    blocks.box(body, 'box-1', 'label-meeting', (box) => {
      blocks.para(box, 'Group meeting');
      blocks.para(box, 'Agreed on ', { math: '\\sigma = 0.3' }, '.');
    });
    blocks.element(body, 'blockMath', { latex: '\\int_0^1 x^2\\,dx' });
    blocks.element(body, 'blockquote', {}, (q) => blocks.para(q, 'quoted'));
    blocks.element(body, 'horizontalRule');
    blocks.element(body, 'image', { file: 'file-1', alt: 'plot', width: 800, height: 600 });
    blocks.element(body, 'somethingNewer', {}, (e) => blocks.para(e, 'from a newer version'));

    const read = readJournal(doc);
    const plain = (b) => b.inline.map((i) => (i.math !== undefined ? `$${i.math}$` : i.text)).join('');
    expect(read.map((b) => b.kind)).toEqual(['text', 'text', 'text', 'text', 'text', 'text', 'task', 'box', 'math', 'text', 'rule', 'image', 'text']);
    expect(read[0].inline).toEqual([
      { text: 'Discussed ', marks: {}, from: 0 },
      { text: 'priors', marks: { italic: {} }, from: 10 },
      { text: ' for the fits.', marks: {}, from: 16 },
    ]);
    // Each block has its element, and a key that stays while the element does.
    expect(read[0].el.nodeName).toBe('paragraph');
    expect(new Set(read.map((b) => b.key)).size).toBe(read.length);
    expect(read[1]).toMatchObject({ style: 'heading', level: 2 });
    expect(read.slice(2, 6).map((b) => [b.marker, b.indent, plain(b)])).toEqual([
      ['•', 0, 'first point'],
      ['•', 0, 'second point'],
      ['•', 1, 'nested'],
      ['3.', 0, 'third'],
    ]);
    expect(read[6]).toMatchObject({ kind: 'task', id: 'task-1' });
    expect(read[7]).toMatchObject({ kind: 'box', id: 'box-1', label: 'label-meeting' });
    expect(read[7].blocks.map(plain)).toEqual(['Group meeting', 'Agreed on $\\sigma = 0.3$.']);
    expect(read[8]).toMatchObject({ kind: 'math', latex: '\\int_0^1 x^2\\,dx' });
    expect(read[9]).toMatchObject({ quote: 1 });
    expect(read[11]).toMatchObject({ kind: 'image', file: 'file-1', alt: 'plot', width: 800, height: 600 });
    expect(plain(read[12])).toBe('from a newer version');
    expect(read[12].editable).toBe(false);
  });
});
