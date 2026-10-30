import { addDays, fullDay, relativeDay } from '@almanac/shared';
import { lineWidth, piece, spread, truncate, wrap } from '../text.js';
import { boxBlockRows, markSection, viewSwitch } from './day.js';

const NEAR = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' };

// The label a "by label" view shows: the one asked for, else the one used most recently, as the
// web picks it. Null when there are no labels.
export function pickLabel(labels, id) {
  const byLast = labels.filter((l) => l.last).sort((a, b) => b.last.localeCompare(a.last));
  return labels.find((l) => l.id === id) ?? byLast[0] ?? labels[0] ?? null;
}

// How a label's been used: "9 days · last today".
export function labelUse(label, today) {
  if (!label.days) return 'no notes yet';
  return `${label.days} ${label.days === 1 ? 'day' : 'days'} · last ${relativeDay(label.last, today).toLowerCase()}`;
}

// The journal by label, in the journal pane's rows (see dayRows): the label, the others to step
// to, then a section for each day with a box under it, newest first, holding that day's boxes to
// read and write in. Today always has a section, to start one in. `days` are { date, boxes }, the
// boxes as readJournal gives them; `more` says older days are left to show.
export function labelRows(ctx) {
  const { label, labelList, days, more, theme, w, today } = ctx;
  const cw = w - 4;
  const rows = [{ line: spread([piece('LABEL', { fg: theme.accent, bold: true })], viewSwitch('label', theme), cw), margin: 1 }];
  if (!label) {
    rows.push({ line: [piece('No labels yet', { bold: true })], margin: 1 }, { line: [] });
    const help = 'Put notes in a box under a label to read them here by label: type #meeting at the start of a line in a day’s journal, or n on a block there.';
    for (const line of wrap([piece(help, { fg: theme.muted })], cw)) rows.push({ line, margin: 1 });
    return rows;
  }
  const colors = theme.label(label.color);
  rows.push({
    line: spread([piece(`● ${label.name}`, { fg: colors.text, bold: true })], [piece(labelUse(label, today), { fg: theme.muted })], cw),
    margin: 1,
    stop: 'label-head',
    data: { kind: 'labelHead', label },
  });
  ctx.picker('label-head', rows, { lead: [], margin: 1 });
  rows.push({ line: labelTabs(labelList, label, theme, cw), margin: 1 }, { line: [] });

  const lead = [piece('▎', { fg: colors.text }), piece(' ')];
  for (const { date, boxes } of days) {
    const near = [-1, 0, 1].find((n) => addDays(today, n) === date);
    const name = near !== undefined ? `${NEAR[near]} · ${fullDay(date, today)}` : fullDay(date, today);
    const start = rows.length;
    rows.push({ line: [piece(name, { bold: true })], margin: 1, stop: `day:${date}`, data: { kind: 'labelDay', date } });
    // Each box is one for J and K, the first with its day's line.
    boxes.forEach((box, i) => {
      if (i > 0) rows.push({ line: [] });
      const from = rows.length;
      boxBlockRows(ctx, rows, box, { lead, bg: colors.box, w: w - 6, date, boxOnly: true });
      markSection(rows, i ? from : start, `box:${date}:${box.key}`);
    });
    if (!boxes.length) {
      rows.push({ line: [piece('+ Add to today', { fg: theme.faint })], margin: 1, stop: 'label-add', data: { kind: 'labelAdd', date } });
      markSection(rows, start, `day:${date}`);
    }
    rows.push({ line: [] });
  }
  if (more) rows.push({ line: [piece(`${more} older ${more === 1 ? 'day' : 'days'}`, { fg: theme.faint })], margin: 1, stop: 'label-more', data: { kind: 'labelMore' } });
  return rows;
}

// The labels to step through with [ and ], the one showing as a chip in its color, scrolled so
// it's in view.
function labelTabs(labels, current, theme, w) {
  const tabs = labels.map((l) =>
    l.id === current.id ? piece(` ${l.name} `, { fg: theme.label(l.color).text, bg: theme.label(l.color).chip, bold: true }) : piece(` ${l.name} `, { fg: theme.muted }),
  );
  const at = labels.findIndex((l) => l.id === current.id);
  let start = 0;
  while (start < at && lineWidth(tabs.slice(start, at + 1)) > w) start++;
  return truncate(tabs.slice(start), w);
}
