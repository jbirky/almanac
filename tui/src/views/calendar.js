import { addDays, shortMonth, weekday } from '@almanac/shared';
import { piece } from '../text.js';

// How many weeks of calendar fit in `w` columns: two columns a day, after the weekday letters.
export const calendarWeeks = (w) => Math.max(4, Math.floor((w - 2) / 2));

// The Sunday that starts the week a date is in.
export const weekStart = (date) => addDays(date, -weekday(date));

// The first Sunday the calendar shows: where it is now, moved only as far as keeps `day` in
// view. It starts with four weeks ahead of today's in view, as on the web.
export function calendarStart(current, day, today, weeks) {
  const start = current ?? addDays(weekStart(today), -7 * (weeks - 5));
  if (day < start) return weekStart(day);
  if (day >= addDays(start, 7 * weeks)) return addDays(weekStart(day), -7 * (weeks - 1));
  return start;
}

// The calendar as eight lines: the months, then a line per weekday, Sunday first, a column per
// week. Each day is ■, shaded darker the more tasks were finished; ▣ if the journal has writing;
// · if it's still ahead; and • after it if something is due. The open day is highlighted.
// `matches` (a set of dates) shows search results or a label's days in `matchColor`.
export function calendarLines({ first, weeks, day, today, counts, matches, matchColor, theme }) {
  const max = Math.max(4, ...Object.values(counts).map((c) => c.done));
  const months = [piece('  ')];
  let col = 0;
  let lastMonth = -3;
  for (let week = 0; week < weeks; week++) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(first, week * 7 + i));
    const firstOfMonth = days.find((d) => d.endsWith('-01'));
    if (firstOfMonth && week - lastMonth >= 3 && week * 2 >= col) {
      months.push(piece(' '.repeat(week * 2 - col)), piece(shortMonth(firstOfMonth), { fg: theme.muted }));
      col = week * 2 + shortMonth(firstOfMonth).length;
      lastMonth = week;
    }
  }
  const lines = [months];
  for (let wd = 0; wd < 7; wd++) {
    const name = { 1: 'M', 3: 'W', 5: 'F' }[wd] ?? ' ';
    const line = [piece(`${name} `, { fg: theme.muted })];
    for (let week = 0; week < weeks; week++) {
      const date = addDays(first, week * 7 + wd);
      const c = counts[date];
      let glyph = '■';
      let fg = theme.cell;
      if (matches) {
        if (matches.has(date)) fg = matchColor;
        else if (date > today) [glyph, fg] = ['·', theme.faint];
      } else if (date > today) {
        [glyph, fg] = ['·', theme.faint];
      } else if (c?.done) {
        glyph = c.words ? '▣' : '■';
        fg = theme.levels[Math.ceil((4 * c.done) / max) - 1];
      } else if (c?.words) {
        [glyph, fg] = ['▣', theme.muted];
      }
      const due = !matches && c?.due ? '•' : ' ';
      if (date === day) line.push(piece(glyph + due, { fg: theme.accent, inverse: true }));
      else line.push(piece(glyph, { fg }), piece(due, { fg: theme.text }));
    }
    lines.push(line);
  }
  return lines;
}

// The line under the calendar: the open day, and what it holds, as the web's tooltip says it.
export function describeDay(name, c) {
  const parts = [];
  if (c?.done) parts.push(`${c.done} done`);
  if (c?.words) parts.push(`${c.words} ${c.words === 1 ? 'word' : 'words'}`);
  if (c?.due) parts.push(`${c.due} due`);
  return { name, rest: parts.length ? ` · ${parts.join(' · ')}` : '' };
}
