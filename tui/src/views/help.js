import { piece, wrap } from '../text.js';

const EVERYWHERE = [
  ['Tab  Shift+Tab', 'Next or previous pane: calendar, tasks, journal'],
  ['H  L', 'The column to the left or right: tasks, journal'],
  ['J  K', 'Next or previous box: the Due panel, a notes box, a category; above the tasks, the calendar'],
  ['Ctrl+K  a', 'Add a task, in the box above the list'],
  ['/', 'Search. Esc clears it.'],
  ['[  ]', 'Previous or next day. By label: previous or next label.'],
  ['t', 'Today'],
  ['g', 'Go to a date: "fri", "oct 3", "2025-12-24"'],
  ['v', 'Switch between By day and By label'],
  ['<  >', 'Narrow or widen the left pane. Below 100 columns, Tab shows one pane at a time.'],
  ['u', 'In the journal: undo. Elsewhere: bring back the task deleted last.'],
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
  ['h  l', 'Move the cursor through the block’s text (in a task, its title)'],
  ['i  Enter', 'Write there. Until h or l moves it, the cursor is at the end.'],
  ['o  O', 'New line below or above, and write'],
  ['Alt+↑  Alt+↓', "Move the block, into and out of notes boxes; on a box's label, the box"],
  ['n', 'New notes box: pick or make its label'],
  ['Enter', "On a box's label: its notes by label, its label, pinning, removing it"],
  ['Enter', 'On an image: open it in your image viewer'],
  ['p', "On a box's label: pin it to the days after, or unpin it"],
  ['D', 'Delete the block. On a task, deletes the task too.'],
  ['u  Ctrl+R', 'Undo or redo your own journal edits'],
];

const WRITING = [
  ['Esc', 'Stop writing. It saves within a second either way.'],
  ['Enter', 'New paragraph. On an empty last line in a box, leaves the box.'],
  ['Backspace', 'At the start, joins the line above. In an empty box, removes the box.'],
  ['Ctrl+A  Ctrl+E', 'Start or end of the line'],
  ['Alt+B  Alt+F', 'A word back or ahead. Ctrl+W deletes one.'],
  ['Alt+↑  Alt+↓', 'Move the block, or the task whose title it is'],
  ['Ctrl+K', 'Add a task in the task box'],
  ['[]  #label', 'At the start of a line: a task, or a notes box with that label'],
  ['#  -  1.  >', 'At the start of a line: a heading, a list, a quote'],
  ['$x^2$  **b**', 'A formula; bold, *italic*, `code`, ~~strike~~ as on the web'],
];

const BY_LABEL = [
  ['[  ]', 'Previous or next label'],
  ['L', 'Pick a label by name'],
  ['e', 'Rename, recolor or delete the label, on every box with it'],
  ['Enter', 'On a date: open that day. On + Add to today: start a box today.'],
  ['i  o  D', "Write in a day's box, as in its journal"],
];

// The keys, for the journal pane's place while ? is open, `w` wide: everywhere first, then where
// the cursor is.
export function helpRows(pane, searching, theme, view = 'day', w = 80) {
  const sections = [['Everywhere', EVERYWHERE]];
  if (pane === 'journal' && view === 'label') sections.push(['By label', BY_LABEL]);
  if (pane === 'calendar') sections.push(['Calendar', CALENDAR]);
  if (pane === 'tasks' && searching) sections.push(['Search', SEARCH]);
  if (pane === 'tasks' && !searching) sections.push(['Tasks', TASKS]);
  if (pane === 'journal') sections.push(['Journal', JOURNAL], ['Writing', WRITING], ['Tasks', TASKS.slice(0, -1)]);
  const rows = [{ line: [piece('KEYS', { fg: theme.accent, bold: true })], margin: 1 }, { line: [] }];
  for (const [name, keys] of sections) {
    rows.push({ line: [piece(name, { bold: true })], margin: 1 });
    for (const [key, desc] of keys) {
      // A description too long for its line goes on under itself.
      wrap([piece(desc, { fg: theme.muted })], Math.max(20, w - 21)).forEach((line, i) => {
        rows.push({ line: [piece(i ? ' '.repeat(16) : key.padEnd(16), { fg: theme.text, bold: true }), ...line], margin: 3 });
      });
    }
    rows.push({ line: [] });
  }
  rows.push({ line: [piece('Any key closes this.', { fg: theme.faint })], margin: 1 });
  return rows;
}
