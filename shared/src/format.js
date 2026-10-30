import { addDays, localDayBounds } from './util.js';

// Dates in words, as the web app and the terminal show them, in the device's own language.

const parse = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// "Today", "Tomorrow", "Yesterday", "Fri", or "Oct 20".
export function relativeDay(dateStr, today) {
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  if (dateStr === addDays(today, -1)) return 'Yesterday';
  const date = parse(dateStr);
  if (dateStr > today && dateStr < addDays(today, 7)) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDay(dateStr) {
  return parse(dateStr).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// Like longDay, with the year when it isn't this year's.
export function fullDay(dateStr, today) {
  if (dateStr.slice(0, 4) === today.slice(0, 4)) return longDay(dateStr);
  return parse(dateStr).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// "Tue, Oct 20", with the year when it isn't this year's.
export function shortDay(dateStr, today) {
  const year = dateStr.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric';
  return parse(dateStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year });
}

export function shortMonth(dateStr) {
  return parse(dateStr).toLocaleDateString(undefined, { month: 'short' });
}

// 0 for Sunday through 6 for Saturday.
export function weekday(dateStr) {
  return parse(dateStr).getDay();
}

export function timeOfDay(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// "9:00 – 10:30 AM".
export function timeRange(startIso, endIso) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatRange(new Date(startIso), new Date(endIso));
  } catch {
    return `${timeOfDay(startIso)} – ${timeOfDay(endIso)}`;
  }
}

// When a calendar event is, on `day` (one of the days it's on): "All day", "9:00 – 10:30 AM",
// "From 10:00 PM" for one going on past midnight, or "Until 2:00 AM" for one that began before.
export function eventTime({ allDay, start, end }, day) {
  if (allDay) return 'All day';
  const [dayStart, dayEnd] = localDayBounds(day);
  const before = start < dayStart;
  const after = end > dayEnd;
  if (before && after) return 'All day';
  if (before) return `Until ${timeOfDay(end)}`;
  if (after) return `From ${timeOfDay(start)}`;
  return start === end ? timeOfDay(start) : timeRange(start, end);
}
