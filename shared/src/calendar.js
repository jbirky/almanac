import ICAL from 'ical.js';
import { addDays, localDayBounds } from './util.js';

// Events from calendar feeds: an ICS link, such as the one Proton Calendar gives a calendar shared
// with a link. The server reads each feed (server/src/calendars.js) and keeps an `events` row per
// event (per UID): its `data` is the event as parseFeed below makes it, so every device has the
// events offline, and each works out when a repeating one happens, in its own time zone.
//
// An event's data: { title, location, description, url, start, tz, length, rrule, rdates, exdates,
// moved, first, last }. `start` is when it (first) starts as a wall time in zone `tz`
// ("2026-10-29T09:00:00"), or a date ("2026-10-29") for an all-day event; null if the feed has
// only changed occurrences of it. `tz` is an IANA zone, "UTC", or null for the device's own time.
// `length` is in seconds, or in days for an all-day event. `rrule` is how it repeats, with any
// UNTIL as a wall time in `tz`; `rdates` and `exdates` are wall times it also happens and doesn't.
// `moved` are occurrences changed on their own, each { of, start, length, title, ... }: `of` the
// wall time of the occurrence it replaces. `first` and `last` are dates every occurrence falls
// between, two days wide on each side for time zones; `last` is null if it repeats forever.

// How far a recurrence is followed before giving up on it.
const MAX_STEPS = 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const isDate = (wall) => wall.length === 10;

// Intl's formatter for an IANA zone, which also says whether there is one by that name.
const formatters = new Map();
function zoneFormat(tz) {
  if (!formatters.has(tz)) {
    let format = null;
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      // Not a zone Intl knows.
    }
    formatters.set(tz, format);
  }
  return formatters.get(tz);
}
export const isZone = (tz) => typeof tz === 'string' && zoneFormat(tz) !== null;

const pad = (n, size = 2) => String(n).padStart(size, '0');
const fields = (wall) => wall.match(/\d+/g).map(Number);

// The wall time in `tz` at UTC time `ms`.
export function utcToWall(ms, tz) {
  const d = new Date(Math.floor(ms / 1000) * 1000);
  let parts;
  if (tz === 'UTC') parts = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
  else if (tz === null) parts = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  else {
    const p = Object.fromEntries(zoneFormat(tz).formatToParts(d).map(({ type, value }) => [type, Number(value)]));
    parts = [p.year, p.month, p.day, p.hour, p.minute, p.second];
  }
  const [y, mo, day, h, mi, s] = parts;
  return `${pad(y, 4)}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
}

// The UTC time (ms) of wall time `wall` in `tz`. A time skipped when the clocks go forward comes
// out an hour on either side of it.
export function wallToUtc(wall, tz) {
  const [y, mo, d, h = 0, mi = 0, s = 0] = fields(wall);
  if (tz === null) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC') return asUtc;
  const offset = (ms) => Date.parse(`${utcToWall(ms, tz)}Z`) - Math.floor(ms / 1000) * 1000;
  const first = offset(asUtc);
  const second = offset(asUtc - first);
  return asUtc - second;
}

// `wall` moved on by `seconds`, as wall times go (no time zone).
const wallPlus = (wall, seconds) => utcToWall(Date.parse(`${wall}Z`) + seconds * 1000, 'UTC');

// ---------------------------------------------------------------------------------------------
// Reading a feed (on the server)

export class FeedError extends Error {}

// A feed's ICS text as { name, events }: the calendar's name if it gives one, and a Map of each
// event's UID to its data. A FeedError says why it isn't a calendar.
export function parseFeed(text) {
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')));
  } catch {
    throw new FeedError("It isn't a calendar.");
  }
  if (root.name !== 'vcalendar') throw new FeedError("It isn't a calendar.");
  // Zones defined in the feed, for a TZID that isn't an IANA zone (an Outlook one, say).
  const zones = new Map();
  for (const c of root.getAllSubcomponents('vtimezone')) {
    try {
      zones.set(c.getFirstPropertyValue('tzid'), new ICAL.Timezone(c));
    } catch {
      // A zone that can't be read; its times are read as the device's own.
    }
  }
  const byUid = new Map();
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const uid = vevent.getFirstPropertyValue('uid');
    if (!uid) continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(vevent);
  }
  const events = new Map();
  for (const [uid, components] of byUid) {
    try {
      const data = readEvent(components, zones);
      if (data) events.set(String(uid), data);
    } catch {
      // An event that can't be read is left out, not the whole calendar.
    }
  }
  const name = root.getFirstPropertyValue('x-wr-calname');
  return { name: typeof name === 'string' && name.trim() ? name.trim() : null, events };
}

// One event's data from its VEVENTs: the event itself and its changed occurrences. Null if it's
// cancelled, or has nothing in it to show.
function readEvent(components, zones) {
  const master = components.find((c) => !c.hasProperty('recurrence-id')) ?? null;
  if (master && status(master) === 'CANCELLED') return null;
  const dtstart = master?.getFirstProperty('dtstart');
  // The zone its times are kept in: its own start's, or without one, its first changed one's.
  const zoned = dtstart ?? components[0].getFirstProperty('dtstart');
  const tz = zoned ? zoneOf(zoned, zones) : null;
  const wall = (prop, value = prop.getFirstValue()) => toWall(value, prop.getParameter('tzid'), tz, zones);
  const data = {
    ...text(master),
    start: dtstart ? wall(dtstart) : null,
    tz,
    length: master ? lengthOf(master, zones) : 0,
    rrule: null,
    rdates: [],
    exdates: [],
    moved: [],
    first: null,
    last: null,
  };
  const allDay = data.start !== null && isDate(data.start);
  // A date for an all-day event, though the feed gives a time.
  const asStart = (w) => (allDay ? w.slice(0, 10) : w);

  const recur = master?.getFirstPropertyValue('rrule');
  if (recur && data.start) {
    if (recur.until) {
      const until = toWall(recur.until, null, tz, zones);
      recur.until = allDay
        ? ICAL.Time.fromDateString(until.slice(0, 10))
        : ICAL.Time.fromDateTimeString(isDate(until) ? `${until}T23:59:59` : until);
    }
    data.rrule = recur.toString();
  }
  for (const [name, list] of [
    ['rdate', data.rdates],
    ['exdate', data.exdates],
  ]) {
    for (const prop of master?.getAllProperties(name) ?? []) {
      for (const value of prop.getValues()) {
        // An RDATE can be a period; it starts the occurrence. A date on an event with a time
        // only takes out an EXDATE's day.
        const time = value instanceof ICAL.Period ? value.start : value;
        const w = time instanceof ICAL.Time ? asStart(wall(prop, time)) : null;
        if (w && (isDate(w) === allDay || name === 'exdate')) list.push(w);
      }
    }
  }
  for (const c of components) {
    if (c === master) continue;
    const of = asStart(wall(c.getFirstProperty('recurrence-id')));
    if (status(c) === 'CANCELLED') {
      data.exdates.push(of);
      continue;
    }
    const start = c.getFirstProperty('dtstart');
    if (!start) continue;
    data.moved.push({ of, start: wall(start), length: lengthOf(c, zones), ...text(c) });
  }
  if (data.start === null && !data.moved.length) return null;
  [data.first, data.last] = span(data);
  return data;
}

const status = (c) => String(c.getFirstPropertyValue('status') ?? '').toUpperCase();

function text(c) {
  const get = (name) => {
    const value = c?.getFirstPropertyValue(name);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return { title: get('summary'), location: get('location'), description: get('description'), url: get('url') };
}

// The zone a DTSTART is kept in: its IANA zone, UTC, or null for the device's own time (a
// floating time, or a zone it doesn't know). One defined only in the feed becomes UTC.
function zoneOf(prop, zones) {
  const time = prop.getFirstValue();
  if (time.isDate) return null;
  if (time.zone === ICAL.Timezone.utcTimezone) return 'UTC';
  const tzid = prop.getParameter('tzid');
  if (isZone(tzid)) return tzid;
  return tzid && zones.has(tzid) ? 'UTC' : null;
}

// `time` (an ICAL.Time, with its TZID) as a wall time in `tz`, or a date if it's a date.
function toWall(time, tzid, tz, zones) {
  if (time.isDate) return time.toString();
  let ms = null;
  if (time.zone === ICAL.Timezone.utcTimezone) ms = time.toUnixTime() * 1000;
  else if (tzid && tzid === tz) return time.toString();
  else if (isZone(tzid)) ms = wallToUtc(time.toString(), tzid);
  else if (tzid && zones.has(tzid)) {
    const zoned = time.clone();
    zoned.zone = zones.get(tzid);
    ms = zoned.toUnixTime() * 1000;
  }
  // A floating time stays as it is.
  if (ms === null) return time.toString();
  return utcToWall(ms, tz ?? 'UTC');
}

// How long a VEVENT lasts: seconds, or days for an all-day one.
function lengthOf(c, zones) {
  const start = c.getFirstProperty('dtstart');
  if (!start) return 0;
  const from = start.getFirstValue();
  const end = c.getFirstProperty('dtend');
  const duration = c.getFirstPropertyValue('duration');
  if (from.isDate) {
    if (end) return Math.max(1, Math.round((Date.parse(end.getFirstValue().toString().slice(0, 10)) - Date.parse(from.toString())) / DAY_MS));
    return duration ? Math.max(1, Math.round(duration.toSeconds() / 86400)) : 1;
  }
  if (end) {
    const instant = (prop) => wallToUtc(toWall(prop.getFirstValue(), prop.getParameter('tzid'), 'UTC', zones), 'UTC');
    return Math.max(0, Math.round((instant(end) - instant(start)) / 1000));
  }
  return duration ? Math.max(0, duration.toSeconds()) : 0;
}

// The dates an event's occurrences all fall between, two days wide on each side (an event's zone
// can be a day ahead of or behind a device's); the end is null if it repeats forever.
function span(data) {
  const starts = [...data.rdates.map((w) => [w, data.length]), ...data.moved.map((m) => [m.start, m.length])];
  let forever = false;
  if (data.start !== null) {
    starts.push([data.start, data.length]);
    if (data.rrule) {
      const recur = ICAL.Recur.fromString(data.rrule);
      forever = !recur.isFinite();
      const it = forever ? null : recur.iterator(icalTime(data.start));
      for (let t, steps = 0; it && (t = it.next()); ) {
        if (++steps > MAX_STEPS) {
          forever = true;
          break;
        }
        starts.push([t.toString(), data.length]);
      }
    }
  }
  const first = starts.map(([w]) => w.slice(0, 10)).reduce((a, b) => (b < a ? b : a));
  if (forever) return [addDays(first, -2), null];
  const last = starts
    .map(([w, length]) => (isDate(w) ? addDays(w, Math.max(1, length)) : wallPlus(w, length)).slice(0, 10))
    .reduce((a, b) => (b > a ? b : a));
  return [addDays(first, -2), addDays(last, 2)];
}

const icalTime = (wall) => (isDate(wall) ? ICAL.Time.fromDateString(wall) : ICAL.Time.fromDateTimeString(wall));

// ---------------------------------------------------------------------------------------------
// When events happen (on each device)

// The occurrences of an event (its data) that overlap the local dates [from, to), each { key,
// title, location, description, url, allDay, start, end }: `key` the wall time it would start at
// had it not been moved, `start` and `end` UTC ISO times, or for an all-day one dates (`end` the
// day after it).
export function occurrences(data, from, to) {
  // Wall times can be a day or so off the device's dates; these are checked exactly below.
  const lo = addDays(from, -2);
  const hi = addDays(to, 2);
  const [rangeStart, rangeEnd] = localDayBounds(from, to);
  const skip = new Set([...data.exdates, ...data.moved.map((m) => m.of)]);
  const seen = new Set();
  const out = [];
  const add = (key, start, length, fields) => {
    const occurrence = isDate(start)
      ? { allDay: true, start, end: addDays(start, Math.max(1, length)) }
      : { allDay: false, start: new Date(wallToUtc(start, data.tz)).toISOString(), end: new Date(wallToUtc(start, data.tz) + length * 1000).toISOString() };
    const overlaps = occurrence.allDay
      ? occurrence.start < to && occurrence.end > from
      : occurrence.start < rangeEnd && (occurrence.end > rangeStart || (occurrence.end === occurrence.start && occurrence.start >= rangeStart));
    if (overlaps) out.push({ key, ...fields, ...occurrence });
  };
  const own = { title: data.title, location: data.location, description: data.description, url: data.url };
  if (data.start !== null) {
    // Occurrences that end before `lo` can be passed over without working out their times.
    const days = isDate(data.start) ? data.length : Math.ceil(data.length / 86400);
    const before = addDays(lo, -days);
    for (const wall of [...(data.rrule ? repeats(data, before, hi) : [data.start]), ...data.rdates]) {
      const date = wall.slice(0, 10);
      if (skip.has(wall) || skip.has(date) || seen.has(wall) || date < before || date >= hi) continue;
      seen.add(wall);
      add(wall, wall, data.length, own);
    }
  }
  for (const m of data.moved) {
    add(m.of, m.start, m.length, {
      title: m.title ?? own.title,
      location: m.location ?? own.location,
      description: m.description ?? own.description,
      url: m.url ?? own.url,
    });
  }
  return out;
}

// The start times worked out so far for each repeating event, by its start and rule, carried on
// as later dates are asked for. Following a rule is slow (ical.js takes several microseconds a
// step, and a daily event of some years has thousands of steps), so a day's events don't follow
// each one from its start every time. The ones used least recently go first.
const followed = new Map();
const MAX_FOLLOWED = 500;

// The wall times a repeating event starts at with dates in [from, to).
function repeats(data, from, to) {
  const key = `${data.start} ${data.rrule}`;
  let f = followed.get(key);
  if (f) followed.delete(key);
  else {
    f = { it: ICAL.Recur.fromString(data.rrule).iterator(icalTime(data.start)), walls: [], done: false };
    if (followed.size >= MAX_FOLLOWED) followed.delete(followed.keys().next().value);
  }
  followed.set(key, f);
  while (!f.done && !(f.walls.length && f.walls.at(-1) >= to)) {
    const t = f.walls.length < MAX_STEPS ? f.it.next() : null;
    if (t) f.walls.push(t.toString());
    else f.done = true;
  }
  // Wall times sort as dates do, and one on a date sorts after the date itself.
  let lo = 0;
  for (let hi = f.walls.length; lo < hi; ) {
    const mid = (lo + hi) >> 1;
    if (f.walls[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  const walls = [];
  for (let i = lo; i < f.walls.length && f.walls[i] < to; i++) walls.push(f.walls[i]);
  return walls;
}
