import { addDays, eventTime, fullDay, shortDay } from '@almanac/shared';
import { layoutText } from '../journal/layout.js';
import { latexToUnicode } from '../journal/math.js';
import { lineWidth, piece, spread, truncate, width, wrap } from '../text.js';
import { subtaskLine, taskLine } from './rows.js';

const NEAR = { [-1]: 'YESTERDAY', 0: 'TODAY', 1: 'TOMORROW' };

// The journal pane's rows: the day's name, its events from the calendars the server reads (if it
// reads any), its Due panel, the notes boxes pinned on earlier days, then the day's journal. A row is { line, margin, bg, stop, part, data, text }: its pieces,
// the columns before them that keep the pane's own background, the background after that, and,
// on the rows the cursor can stop on, the stop's key and what's there (`part` marks a stop's other
// rows). A row of a textblock's text has `text`: { el, from, to, x, cols }, the places on it and
// their columns (x is where the text starts), for the cursor to move by. `ctx.typed(key, w)`
// gives the pieces of what's being typed at a stop, if anything is, and `ctx.caret` is the cursor
// while writing in the journal: { el, offset }, or { pending } in an empty one.
//
// A block's stop is `blk:<its day>:<its key>`, its data { kind, block, own, date, boxOnly }: `own`
// when it can be written in, `date` the day whose journal it's in, and `boxOnly` when it's shown
// as part of a box away from that journal (pinned, or by label), where it stays in its box.
export function dayRows(ctx) {
  const { day, today, dueTasks, pinned, blocks, theme, w, calendars = [], events = [] } = ctx;
  const rows = [];
  const cw = w - 4;
  const near = [-1, 0, 1].find((n) => addDays(today, n) === day);
  // When narrow, how to reach the calendar and tasks; else which view this is.
  const right = ctx.narrow ? [piece('Tab calendar, tasks', { fg: theme.faint })] : viewSwitch('day', theme);
  rows.push({ line: spread([piece(near !== undefined ? NEAR[near] : '', { fg: theme.accent, bold: true })], right, cw), margin: 1 });
  rows.push({ line: spread([piece(fullDay(day, today), { bold: true })], [piece('[ ‹   › ]', { fg: theme.muted })], cw), margin: 1 });
  rows.push({ line: [] });

  const when = near !== undefined ? ['yesterday', 'today', 'tomorrow'][near + 1] : `on ${shortDay(day, today)}`;
  const lead = [piece('  ')];
  const pw = w - 5;
  const panel = (line, extra = {}) => rows.push({ line: [...lead, ...line], bg: theme.panel, ...extra });

  // The events: when, then what and where, wrapped beside it.
  if (calendars.length) {
    panel([]);
    panel([piece(`Events ${when}`, { fg: theme.muted, bold: true })]);
    if (!events.length) panel([piece('No events.', { fg: theme.muted })]);
    const times = events.map((e) => eventTime(e, day));
    const tw = Math.min(Math.max(0, ...times.map(width)), Math.floor(pw / 3));
    events.forEach((e, i) => {
      const where = [e.location, calendars.length > 1 && e.calendar].filter(Boolean).join(' · ');
      const what = [piece(e.title ?? '(No title)'), ...(where ? [piece(` · ${where}`, { fg: theme.muted })] : [])];
      wrap(what, Math.max(1, pw - tw - 2)).forEach((line, j) => {
        const time = truncate([piece(j ? '' : times[i], { fg: theme.muted })], tw);
        panel([...time, piece(' '.repeat(tw - lineWidth(time) + 2)), ...line]);
      });
    });
    panel([]);
    rows.push({ line: [] });
  }

  // The Due panel.
  panel([]);
  panel([piece(`Due ${when}`, { fg: theme.muted, bold: true })]);
  if (!dueTasks.due.length) panel([piece('Nothing due.', { fg: theme.muted })]);
  for (const t of dueTasks.due) taskRows(ctx, rows, `due:${t.id}`, t, { w: pw, lead, bg: theme.panel });
  panel(ctx.typed('due-add', pw) ?? [piece('+', { fg: theme.accent }), piece(` Add a task due ${when}`, { fg: theme.faint })], {
    stop: 'due-add',
    data: { kind: 'dueAdd' },
  });
  const preview = ctx.preview('due-add');
  if (preview) panel([piece('  '), ...preview], { part: 'due-add' });
  for (const [name, list, prefix] of [
    ['Overdue', dueTasks.overdue, 'over'],
    ['Also finished', dueTasks.finished, 'fin'],
  ]) {
    if (!list.length) continue;
    panel([piece(name, { fg: theme.muted, bold: true })]);
    for (const t of list) taskRows(ctx, rows, `${prefix}:${t.id}`, t, { w: pw, lead, bg: theme.panel });
  }
  panel([]);
  rows.push({ line: [] });

  // Boxes pinned on earlier days, each the box itself, from its own day's journal, written in
  // there.
  for (const pin of pinned) {
    boxRows(ctx, rows, `pin:${pin.date}/${pin.box.id}`, pin.box, {
      header: [piece(` · pinned from ${shortDay(pin.date, today)}`, { fg: theme.muted })],
      data: { kind: 'pinHeader', date: pin.date, box: pin.box },
      date: pin.date,
      boxOnly: true,
    });
    rows.push({ line: [] });
  }

  if (!blocks.length) {
    const line = ctx.caret?.pending ? [piece(' ', { inverse: true })] : [piece('Nothing written this day.', { fg: theme.faint })];
    rows.push({ line, margin: 1, stop: 'empty', data: { kind: 'empty', date: day } });
    ctx.picker('empty', rows, { lead: [], margin: 1 });
  }
  blocks.forEach((block, i) => {
    if (i > 0 && !tight(blocks[i - 1], block)) rows.push({ line: [] });
    blockRows(ctx, rows, `blk:${day}:${block.key}`, block, { margin: 1, w: cw, lead: [], own: true, date: day });
  });
  rows.push({ line: [] });
  rows.push({ line: [piece('+ Notes box', { fg: theme.faint })], margin: 1, stop: 'add-box', data: { kind: 'addBox' } });
  ctx.picker('add-box', rows, { lead: [], margin: 1 });
  rows.push({ line: [] });
  return rows;
}

// By day and By label, the one showing marked, as the web's switch shows them.
export const viewSwitch = (view, theme) => [
  piece(' By day ', view === 'day' ? { fg: theme.text, bg: theme.accentSoft, bold: true } : { fg: theme.muted }),
  piece(' By label ', view === 'label' ? { fg: theme.text, bg: theme.accentSoft, bold: true } : { fg: theme.muted }),
];

// Tasks one after another, and the items of a list, go without a blank line between them.
const tight = (a, b) => (a.kind === 'task' && b.kind === 'task') || (a.kind === 'text' && b.kind === 'text' && a.marker && b.marker);

// A task's row, then its subtasks if they're showing, with a row for adding one. `lead` starts
// each row (the Due panel's indent, a box's bar) and `w` is what's left after it.
export function taskRows(ctx, rows, key, task, { w, lead = [], margin = 0, bg, data = {}, quietCategory = false }) {
  const { theme, today, day } = ctx;
  rows.push({
    line: [...lead, ...taskLine(task, { w, theme, today, day, quietCategory, cursor: ctx.cursor === key, title: ctx.typed(`${key}#title`, w - 4) })],
    margin,
    bg,
    stop: key,
    data: { kind: 'task', task, ...data },
  });
  ctx.picker(key, rows, { lead: [...lead, piece('    ')], margin, bg });
  if (!task.id || task.missing || !ctx.openSubtasks.has(task.id)) return;
  const sub = [...lead, piece('    ')];
  for (const s of ctx.subtasksOf(task.id)) {
    const subKey = `${key}/sub:${s.id}`;
    rows.push({
      line: [...sub, ...subtaskLine(s, { w: w - 4, theme, title: ctx.typed(`${subKey}#title`, w - 8) })],
      margin,
      bg,
      stop: subKey,
      data: { kind: 'subtask', task: s, parent: task },
    });
  }
  const addKey = `${key}/add`;
  rows.push({
    line: [...sub, ...(ctx.typed(addKey, w - 4) ?? [piece('+ Add a subtask', { fg: theme.faint })])],
    margin,
    bg,
    stop: addKey,
    data: { kind: 'addSubtask', parent: task },
  });
}

// A notes box: a bar and a tint in its label's color, its label as a chip on its first row, then
// its blocks, from day `date`'s journal.
function boxRows(ctx, rows, key, box, { header = [], data = { kind: 'boxHeader', box }, date, boxOnly = false }) {
  const { theme, w } = ctx;
  const label = ctx.labels.get(box.label) ?? null;
  const colors = theme.label(label?.color ?? null);
  const lead = [piece('▎', { fg: colors.text }), piece(' ')];
  const chip = label ? piece(` ● ${label.name} `, { fg: colors.text, bg: colors.chip }) : piece(' Notes ', { fg: theme.muted, bg: theme.chip });
  const pinnedOn = data.kind === 'boxHeader' && ctx.pinnedFrom.has(box.id) ? [piece(' · pinned to the days after', { fg: theme.muted })] : [];
  rows.push({ line: [...lead, chip, ...header, ...pinnedOn], margin: 1, bg: colors.box, stop: key, data: { ...data, own: true, date } });
  ctx.picker(key, rows, { lead, margin: 1, bg: colors.box });
  boxBlockRows(ctx, rows, box, { lead, bg: colors.box, w: w - 6, date, boxOnly });
}

// A box's blocks, each row after `lead`, its bar.
export function boxBlockRows(ctx, rows, box, { lead, bg, w, date, boxOnly }) {
  const start = rows.length;
  box.blocks.forEach((block) => blockRows(ctx, rows, `blk:${date}:${block.key}`, block, { margin: 1, w, lead, bg, own: true, date, boxOnly }));
  if (rows.length === start) rows.push({ line: lead, margin: 1, bg });
}

// A block's rows, each starting with `lead` (inside a box, its bar; `bg` is its tint).
function blockRows(ctx, rows, key, block, { margin, w, lead, bg, own, date, boxOnly = false }) {
  const { theme } = ctx;
  const push = (line, extra) => rows.push({ line: [...lead, ...line], margin, bg, ...extra });
  const stop = { stop: key, data: { kind: 'block', block, own, date, boxOnly } };
  if (block.kind === 'box') return boxRows(ctx, rows, key, block, { date });
  if (block.kind === 'task') {
    const task = (block.id && ctx.task(block.id)) || { id: block.id, title: '', status: 'open', missing: true };
    return taskRows(ctx, rows, key, task, { w, lead, margin, bg, data: { block, own, date, boxOnly } });
  }
  if (block.kind === 'rule') push([piece('─'.repeat(w), { fg: theme.line })], stop);
  else if (block.kind === 'math') {
    // As Unicode if it can be; its LaTeX while it's being written, or the cursor is on it.
    const typed = ctx.typed(`${key}#latex`, w - 4);
    const unicode = ctx.cursor === key ? null : latexToUnicode(block.latex);
    const shown = typed
      ? [piece('$$', { fg: theme.math }), ...typed, piece('$$', { fg: theme.math })]
      : [piece(unicode ?? `$$${block.latex}$$`, { fg: theme.math, italic: Boolean(unicode) || undefined })];
    wrap(shown, w).forEach((line, i) => {
      const pad = Math.max(0, Math.floor((w - lineWidth(line)) / 2));
      push([piece(' '.repeat(pad)), ...line], i === 0 ? stop : { part: key });
    });
  } else if (block.kind === 'image') {
    // Drawn in place once it's ready (see images.js); until then, or if it can't be, a line
    // naming it.
    const shown = ctx.image(block, w);
    if (shown.lines) shown.lines.forEach((line, i) => push([piece(line, { raw: true })], i === 0 ? stop : { part: key }));
    if (!shown.lines || block.alt) {
      const size = block.width && block.height ? ` · ${block.width} × ${block.height}` : '';
      const what = shown.lines ? [] : [piece('[image] ', { fg: theme.muted }), piece(block.alt || 'Image'), piece(size, { fg: theme.muted })];
      const note = shown.note ? [piece(` · ${shown.note}`, { fg: theme.faint })] : [];
      const caption = shown.lines ? [piece(block.alt, { fg: theme.muted, italic: true })] : [];
      push([...what, ...caption, ...note], shown.lines ? { part: key } : stop);
    }
  } else {
    textRows(ctx, rows, key, block, { margin, w, lead, bg, own, date, boxOnly });
  }
  ctx.picker(key, rows, { lead, margin, bg });
  return undefined;
}

// A textblock's rows: a paragraph, heading, list item or code, wrapped to the pane.
function textRows(ctx, rows, key, block, { margin, w, lead, bg, own, date, boxOnly }) {
  const { theme } = ctx;
  const push = (line, extra) => rows.push({ line: [...lead, ...line], margin, bg, ...extra });
  const stop = { stop: key, data: { kind: 'block', block, own, date, boxOnly } };
  const quote = Array.from({ length: block.quote }, () => piece('▎ ', { fg: theme.muted }));
  const indent = '  '.repeat(block.indent);
  const first = block.marker ? `${indent}${block.marker} ` : indent;
  const style =
    block.style === 'heading'
      ? { bold: true, fg: block.level === 1 ? theme.accent : theme.text }
      : block.style === 'code'
        ? { bg: theme.chip }
        : {};
  const has = (part, mark) => part.marks?.[mark] !== undefined || undefined;
  const caret = own && ctx.caret?.el === block.el ? ctx.caret.offset : null;
  // A formula as Unicode if it can be, and as its LaTeX while the cursor is beside it.
  const formula = (part) => {
    const unicode = caret === part.from || caret === part.from + 1 ? null : latexToUnicode(part.math);
    return unicode ? { text: unicode, style: { fg: theme.math, italic: true } } : { text: `$${part.math}$`, style: { fg: theme.math } };
  };
  const parts = block.inline.map((part) =>
    part.math !== undefined
      ? { ...formula(part), from: part.from, atom: true }
      : {
          text: part.text,
          from: part.from,
          atom: part.atom,
          style: {
            ...style,
            bold: style.bold || has(part, 'bold'),
            italic: has(part, 'italic'),
            strike: has(part, 'strike'),
            underline: has(part, 'underline') || has(part, 'link'),
            fg: has(part, 'link') ? theme.accent : style.fg,
            bg: has(part, 'code') ? theme.chip : style.bg,
          },
        },
  );
  const prefix = lineWidth(lead) + lineWidth(quote) + width(first);
  const lines = layoutText(parts, Math.max(1, w - lineWidth(quote) - width(first)), caret);
  lines.forEach((line, i) => {
    push([...quote, piece(i === 0 ? first : ' '.repeat(width(first)), { fg: theme.muted }), ...line.pieces], {
      ...(i === 0 ? stop : { part: key }),
      ...(own && block.editable ? { text: { el: block.el, from: line.from, to: line.to, x: margin + prefix, cols: line.cols } } : {}),
    });
  });
}
