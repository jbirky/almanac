import { matchCategory, parseCapture, shortDay } from '@almanac/shared';

// A task from a line such as "submit abstract fri #paper", read as the web's task box reads it:
// the first #word is its category (one in use whatever its case, else a new one) and the first
// date its due date, else `due`. Returns what was added, with `isNew` for a new category.
export function addTask(replica, text, due = null) {
  const parsed = parseCapture(text);
  if (!parsed.title) throw new Error('Nothing to add: the task needs a title.');
  const categories = replica.queries.categories();
  const category = parsed.category ? matchCategory(parsed.category, categories) : null;
  const task = { title: parsed.title, due: parsed.due ?? due, category };
  task.id = replica.act('captureTask', task);
  return { ...task, isNew: Boolean(category && !categories.includes(category)) };
}

// "submit abstract · due Fri, Oct 30 · paper"
export function describeTask({ title, due, category }, today) {
  return [title, due && `due ${shortDay(due, today)}`, category].filter(Boolean).join(' · ');
}

// A day's Due panel as plain data, for `almanac today --json`.
export function dayReport(queries, date) {
  const pick = ({ id, title, status, due, category, subtasks, subtasks_done }) => ({ id, title, status, due, category, subtasks, subtasks_done });
  const { due, overdue, finished } = queries.dayTasks(date, date);
  return { date, due: due.map(pick), overdue: overdue.map(pick), finished: finished.map(pick) };
}
