import { addDays, fullDay, shortDay } from '@almanac/shared';
import { lineWidth, piece, spread, width, wrap } from '../text.js';
import { subtaskLine, taskLine } from './rows.js';

const NEAR = { [-1]: 'YESTERDAY', 0: 'TODAY', 1: 'TOMORROW' };

// The journal pane's rows: the day's name, its Due panel, the notes boxes pinned on earlier
// days, then the day's journal. A row is { line, margin, bg, stop, part, data }: its pieces, the
// columns before them that keep the pane's own background, the background after that, and, on
// the rows the cursor can stop on, the stop's key and what's there (`part` marks a stop's other
// rows). `ctx.typed(key, w)` gives the pieces of what's being typed at a stop, if anything is.
export function dayRows(ctx) {
  const { day, today, dueTasks, pinned, blocks, theme, w } = ctx;
  const rows = [];
  const cw = w - 4;
  const near = [-1, 0, 1].find((n) => addDays(today, n) === day);
  rows.push({ line: [piece(near !== undefined ? NEAR[near] : '', { fg: theme.accent, bold: true })], margin: 1 });
  rows.push({ line: spread([piece(fullDay(day, today), { bold: true })], [piece('[ ‹   › ]', { fg: theme.muted })], cw), margin: 1 });
  rows.push({ line: [] });

  // The Due panel.
  const when = near !== undefined ? ['yesterday', 'today', 'tomorrow'][near + 1] : `on ${shortDay(day, today)}`;
  const lead = [piece('  ')];
  const pw = w - 5;
  const panel = (line, extra = {}) => rows.push({ line: [...lead, ...line], bg: theme.panel, ...extra });
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

  // Boxes pinned on earlier days, each the box itself, from its own day's journal.
  for (const pin of pinned) {
    boxRows(ctx, rows, `pin:${pin.date}/${pin.box.id}`, pin.box, {
      header: [piece(` · pinned from ${shortDay(pin.date, today)}`, { fg: theme.muted })],
      data: { kind: 'pinHeader', date: pin.date, box: pin.box },
    });
    rows.push({ line: [] });
  }

  if (!blocks.length) rows.push({ line: [piece('Nothing written this day.', { fg: theme.faint })], margin: 1, stop: 'empty', data: { kind: 'empty' } });
  blocks.forEach((block, i) => {
    if (i > 0 && !tight(blocks[i - 1], block)) rows.push({ line: [] });
    blockRows(ctx, rows, `blk:${i}`, block, { margin: 1, w: cw, lead: [] });
  });
  rows.push({ line: [] });
  return rows;
}

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
// its blocks.
function boxRows(ctx, rows, key, box, { header = [], data = { kind: 'boxHeader', box } }) {
  const { theme, w } = ctx;
  const label = ctx.labels.get(box.label) ?? null;
  const colors = theme.label(label?.color ?? null);
  const lead = [piece('▎', { fg: colors.text }), piece(' ')];
  const chip = label ? piece(` ● ${label.name} `, { fg: colors.text, bg: colors.chip }) : piece(' Notes ', { fg: theme.muted, bg: theme.chip });
  const pinnedOn = data.kind === 'boxHeader' && ctx.pinnedFrom.has(box.id) ? [piece(' · pinned to the days after', { fg: theme.muted })] : [];
  rows.push({ line: [...lead, chip, ...header, ...pinnedOn], margin: 1, bg: colors.box, stop: key, data });
  const start = rows.length;
  box.blocks.forEach((block, i) => blockRows(ctx, rows, `${key}.${i}`, block, { margin: 1, w: w - 6, lead, bg: colors.box }));
  if (rows.length === start) rows.push({ line: lead, margin: 1, bg: colors.box });
}

// A block's rows, each starting with `lead` (inside a box, its bar; `bg` is its tint).
function blockRows(ctx, rows, key, block, { margin, w, lead, bg }) {
  const { theme } = ctx;
  const push = (line, extra) => rows.push({ line: [...lead, ...line], margin, bg, ...extra });
  const stop = { stop: key, data: { kind: 'block', block } };
  if (block.kind === 'box') return boxRows(ctx, rows, key, block, {});
  if (block.kind === 'task') {
    const task = (block.id && ctx.task(block.id)) || { id: block.id, title: '', status: 'open', missing: true };
    return taskRows(ctx, rows, key, task, { w, lead, margin, bg, data: { block } });
  }
  if (block.kind === 'rule') return push([piece('─'.repeat(w), { fg: theme.line })], stop);
  if (block.kind === 'math') {
    return wrap([piece(`$$${block.latex}$$`, { fg: theme.math })], w).forEach((line, i) => {
      const pad = Math.max(0, Math.floor((w - lineWidth(line)) / 2));
      push([piece(' '.repeat(pad)), ...line], i === 0 ? stop : { part: key });
    });
  }
  if (block.kind === 'image') {
    const size = block.width && block.height ? ` · ${block.width}×${block.height}` : '';
    return push([piece('[image] ', { fg: theme.muted }), piece(block.alt || 'Image'), piece(size, { fg: theme.muted })], stop);
  }
  // Text: a paragraph, heading, list item or code, wrapped to the pane.
  const quote = Array.from({ length: block.quote }, () => piece('▎ ', { fg: theme.muted }));
  const indent = '  '.repeat(block.indent);
  const first = block.marker ? `${indent}${block.marker} ` : indent;
  const style =
    block.style === 'heading'
      ? { bold: true, fg: block.level === 1 ? theme.accent : theme.text }
      : block.style === 'code'
        ? { bg: theme.chip }
        : {};
  const has = (part, mark) => part.marks[mark] !== undefined || undefined;
  const pieces = block.inline.map((part) =>
    part.math !== undefined
      ? piece(`$${part.math}$`, { fg: theme.math })
      : piece(part.text, {
          ...style,
          bold: style.bold || has(part, 'bold'),
          italic: has(part, 'italic'),
          strike: has(part, 'strike'),
          underline: has(part, 'underline') || has(part, 'link'),
          fg: has(part, 'link') ? theme.accent : style.fg,
          bg: has(part, 'code') ? theme.chip : style.bg,
        }),
  );
  const lines = wrap(pieces, Math.max(1, w - lineWidth(quote) - width(first)));
  lines.forEach((line, i) => {
    push([...quote, piece(i === 0 ? first : ' '.repeat(width(first)), { fg: theme.muted }), ...line], i === 0 ? stop : { part: key });
  });
}
