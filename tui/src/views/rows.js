import { relativeDay } from '@almanac/shared';
import { graphemes, lineWidth, piece, truncate, width } from '../text.js';

// Columns kept for a due date at the end of a task's line, so dates, and the category chips
// before them, line up down a list. "Yesterday" is the widest a due date gets in words.
export const DATE_SLOT = 9;

export const chipPiece = (name, theme) => piece(` ${name} `, { fg: theme.accent, bg: theme.accentSoft });

// A task as one line `w` columns wide: its box, title, subtasks done, category and due date.
// `day` is the date the list is about: a due date equal to it shows only on the cursor's line,
// as the web shows it only on hover, and so does the category with `quietCategory` (in a list
// already grouped by category), there only if the title still fits beside it. `title`, in place
// of the title, is what's being typed into it. `point` is where the cursor is in the title while
// browsing (a grapheme), drawn inverted.
export function taskLine(task, { w, theme, today, day = null, quietCategory = false, cursor = false, title = null, point = null }) {
  const done = task.status === 'done';
  const head = [piece(done ? '[x]' : '[ ]', { fg: done ? theme.accent : theme.muted }), piece(' ')];
  const name = title ?? (task.title
    ? pointed(task.title, { fg: done ? theme.muted : theme.text, strike: done }, point)
    : [piece(task.missing ? 'Task not synced yet' : 'Untitled task', { fg: theme.faint })]);
  const showDate = task.status === 'open' && task.due && (cursor || task.due !== day || task.due < today);
  const date = showDate ? piece(relativeDay(task.due, today), { fg: task.due < today ? theme.late : theme.muted }) : null;
  // What goes after the title, flush right: the subtask count, the category, and the date in
  // its column. A list grouped by category keeps the column only to line up dates and counts.
  const tailWith = (chip) => {
    const right = [];
    if (task.subtasks) right.push(piece(`${task.subtasks_done}/${task.subtasks}`, { fg: theme.muted }));
    if (chip) right.push(chipPiece(task.category, theme));
    const tail = right.flatMap((p) => [p, piece('  ')]);
    if (date || task.subtasks || (chip && !quietCategory)) tail.push(piece(' '.repeat(DATE_SLOT - (date ? width(date.text) : 0))), ...(date ? [date] : []));
    else tail.pop();
    return tail;
  };
  const room = (tail) => w - lineWidth(head) - lineWidth(tail) - (tail.length ? 2 : 0);
  let tail = tailWith(Boolean(task.category) && (!quietCategory || cursor));
  if (quietCategory && lineWidth(name) > room(tail)) tail = tailWith(false);
  const shown = truncate(name, Math.max(1, room(tail)));
  return [...head, ...shown, piece(' '.repeat(Math.max(0, w - lineWidth(head) - lineWidth(shown) - lineWidth(tail)))), ...tail];
}

// Text in `style`, with grapheme `point` (or a space after the end) inverted, if there's a point.
function pointed(text, style, point) {
  if (point === null) return [piece(text, style)];
  const chars = graphemes(text);
  return [
    piece(chars.slice(0, point).join(''), style),
    piece(chars[point] ?? ' ', { ...style, inverse: true }),
    piece(chars.slice(point + 1).join(''), style),
  ].filter((p) => p.text);
}

// A subtask under its task: a box and a title.
export function subtaskLine(task, { w, theme, title = null }) {
  const done = task.status === 'done';
  const name = title ?? [task.title ? piece(task.title, { fg: done ? theme.muted : theme.text, strike: done }) : piece('Subtask', { fg: theme.faint })];
  return truncate([piece(done ? '[x]' : '[ ]', { fg: done ? theme.accent : theme.muted }), piece(' '), ...name], w);
}
