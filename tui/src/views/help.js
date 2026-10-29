import { piece } from '../text.js';

const EVERYWHERE = [
  ['Tab  Shift+Tab', 'Next or previous pane: calendar, tasks, journal'],
  ['Ctrl+K  a', 'Add a task, in the box above the list'],
  ['/', 'Search. Esc clears it.'],
  ['[  ]', 'Previous or next day'],
  ['t', 'Today'],
  ['g', 'Go to a date: "fri", "oct 3", "2025-12-24"'],
  ['<  >', 'Narrow or widen the left pane'],
  ['u', 'Bring back the task deleted last'],
  ['Ctrl+S', 'Sync now'],
  ['q', 'Quit. Edits are already saved; it syncs once more first.'],
];

const TASKS = [
  ['j  k', 'Next or previous'],
  ['x  Space', 'Check off, or reopen'],
  ['r', 'Rename'],
  ['c', 'Category: pick one or type a new one'],
  ['d', 'Due date: "fri", "nov 3"; empty removes it'],
  ['s', 'Show or hide subtasks'],
  ['A', 'Add a subtask'],
  ['Enter', 'Open the day it was written in, or is due'],
  ['D', 'Delete it and its subtasks. u brings them back.'],
  ['Alt+↑  Alt+↓', 'In the list: move the task, or the category its name is on'],
];

const CALENDAR = [
  ['← →  h l', 'A week back or ahead'],
  ['↑ ↓  k j', 'A day back or ahead'],
  ['Enter', 'Move to the journal'],
];

const SEARCH = [
  ['j  k', 'Move through the matching days'],
  ['Enter', 'Open that day'],
  ['Esc', 'Clear the search and show the tasks again'],
];

const JOURNAL = [
  ['j  k', 'Next or previous block'],
  ['Enter', 'On a task: as in the list. On a pinned box: open its day.'],
  ['p', "On a box's label: pin it to the days after, or unpin it"],
];

// The keys, for the journal pane's place while ? is open: everywhere first, then where the
// cursor is.
export function helpRows(pane, searching, theme) {
  const sections = [['Everywhere', EVERYWHERE]];
  if (pane === 'calendar') sections.push(['Calendar', CALENDAR]);
  if (pane === 'tasks' && searching) sections.push(['Search', SEARCH]);
  if (pane === 'tasks' && !searching) sections.push(['Tasks', TASKS]);
  if (pane === 'journal') sections.push(['Journal', JOURNAL], ['Tasks', TASKS.slice(0, -1)]);
  const rows = [{ line: [piece('KEYS', { fg: theme.accent, bold: true })], margin: 1 }, { line: [] }];
  for (const [name, keys] of sections) {
    rows.push({ line: [piece(name, { bold: true })], margin: 1 });
    for (const [key, desc] of keys) rows.push({ line: [piece(key.padEnd(16), { fg: theme.text, bold: true }), piece(desc, { fg: theme.muted })], margin: 3 });
    rows.push({ line: [] });
  }
  rows.push({ line: [piece('Writing in the journal comes in the next version. Any key closes this.', { fg: theme.faint })], margin: 1 });
  return rows;
}
