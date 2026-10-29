import { addDays } from '@almanac/shared';

// What the Android app's Today widget is given, and what it gives back. The widget can't reach
// the notes, which live in this page's database, so it shows a copy the page hands it, and tasks
// checked off there come back to be checked off here (lib/widget.js).

// How far ahead the copy reaches, so the widget still knows what's due as days pass with the app
// closed; and how many tasks it takes at most.
const AHEAD_DAYS = 7;
const MOST = 80;

// The widget's copy: the open tasks due by a week from today, soonest first, as
// { at, tasks: [{ id, title, due, category }] }, `at` being when it was made, in milliseconds.
export function widgetSnapshot(tasks, today, at) {
  const until = addDays(today, AHEAD_DAYS);
  const shown = tasks
    .filter((t) => t.status === 'open' && t.due && t.due <= until)
    .sort((a, b) => a.due.localeCompare(b.due) || (a.title ?? '').localeCompare(b.title ?? ''))
    .slice(0, MOST)
    .map(({ id, title, due, category }) => ({ id, title: title ?? '', due, category: category ?? null }));
  return { at, tasks: shown };
}

// Of the tasks checked off in the widget, the ones to check off here: those still open. One done
// or deleted meanwhile (on another device, say) is left as it is.
export function checkOffs(ids, taskOf) {
  return ids.filter((id) => {
    const task = taskOf(id);
    return task && !task.deleted && task.status === 'open';
  });
}
