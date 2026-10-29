import { MATCH_END, MATCH_START, orderCategories, shortDay } from '@almanac/shared';
import { piece, truncate, wrap } from '../text.js';
import { taskRows } from './day.js';

// Open tasks grouped by category, in the order the web shows them: categories in the order set
// on any device, then the others alphabetically, uncategorized tasks last; within each, tasks
// never moved first, soonest due first, then the ones moved, in their order. The "No category"
// heading shows only when there are categories to set it apart. Returns the groups, each
// { name, tasks } ('' for no category), and the named categories in order.
export function groupTasks(tasks, order) {
  const byCategory = new Map();
  for (const t of tasks) {
    const key = t.category ?? '';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(t);
  }
  const named = orderCategories([...byCategory.keys()].filter(Boolean), order);
  const names = byCategory.has('') ? [...named, ''] : named;
  return { groups: names.map((name) => ({ name, tasks: byCategory.get(name) })), named };
}

// The task list's rows, in the same form as the journal pane's (dayRows): a stop on each
// category's name, so Alt+↑ and Alt+↓ can move it, and on each task.
export function taskListRows(ctx, groups) {
  const { theme, w } = ctx;
  const rows = [];
  if (!groups.length) return [{ line: [piece('No open tasks.', { fg: theme.muted })], stop: 'none', data: { kind: 'empty' } }];
  groups.forEach(({ name, tasks }, i) => {
    if (i > 0) rows.push({ line: [] });
    if (name || groups.length > 1) {
      rows.push({ line: [piece(name || 'No category', { fg: theme.muted, bold: true })], stop: `cat:${name}`, data: { kind: 'category', name } });
    }
    for (const t of tasks) taskRows(ctx, rows, `task:${t.id}`, t, { w, quietCategory: true, data: { group: name } });
  });
  return rows;
}

// The days that match a search, each with its line that matched, the matches marked.
export function resultRows(ctx, results) {
  const { theme, w, today } = ctx;
  if (!results.length) return [{ line: [piece('No matching days.', { fg: theme.muted })] }];
  const rows = [];
  for (const r of results) {
    const key = `day:${r.date}`;
    rows.push({ line: [piece(shortDay(r.date, today), { bold: true })], stop: key, data: { kind: 'result', date: r.date } });
    if (r.snippet) {
      const parts = r.snippet.split(new RegExp(`(${MATCH_START}[^${MATCH_END}]*${MATCH_END})`)).filter(Boolean);
      const line = parts.map((part) =>
        part.startsWith(MATCH_START) ? piece(part.slice(1, -1), { fg: theme.text, bg: theme.accentSoft, bold: !theme.tints || undefined }) : piece(part.replace(/\s+/g, ' '), { fg: theme.muted }),
      );
      // Two lines of it at most.
      const lines = wrap(line, w - 2).slice(0, 2);
      lines.forEach((l, i) => rows.push({ line: [piece('  '), ...(i === 1 ? truncate(l, w - 2) : l)], part: key }));
    }
  }
  return rows;
}
