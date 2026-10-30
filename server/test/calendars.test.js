import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventTime, occurrences, parseFeed, timeOfDay } from '@almanac/shared';
import { calendarLinks, createCalendarReader } from '../src/calendars.js';
import { makeDevice, makeServer } from './helpers.js';

const LINK = 'https://calendar.proton.me/api/calendar/v1/url/abc/calendar.ics?CacheKey=k&PassphraseKey=secret';

// A feed as Proton Calendar shares one: a weekly meeting in Zurich, with one week skipped and one
// moved, through the night the clocks go back; a two-day conference; a lunch in UTC.
const feed = ({ meeting = 'Group meeting', lunch = true } = {}) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Proton AG//WebCalendar 5.0.0//EN
METHOD:PUBLISH
X-WR-CALNAME:Work
BEGIN:VTIMEZONE
TZID:Europe/Zurich
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:meeting@proton.me
DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}
DTSTART;TZID=Europe/Zurich:20261006T130000
DTEND;TZID=Europe/Zurich:20261006T140000
RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T225959Z
EXDATE;TZID=Europe/Zurich:20261013T130000
SUMMARY:${meeting}
LOCATION:Room 3.12
DESCRIPTION:Agenda:\\nhttps://example.org/agenda
END:VEVENT
BEGIN:VEVENT
UID:meeting@proton.me
DTSTAMP:20261001T120000Z
RECURRENCE-ID;TZID=Europe/Zurich:20261020T130000
DTSTART;TZID=Europe/Zurich:20261021T150000
DTEND;TZID=Europe/Zurich:20261021T160000
SUMMARY:${meeting} (moved)
END:VEVENT
BEGIN:VEVENT
UID:conference@proton.me
DTSTAMP:20261001T120000Z
DTSTART;VALUE=DATE:20261028
DTEND;VALUE=DATE:20261030
SUMMARY:Conference
END:VEVENT
${
  lunch
    ? `BEGIN:VEVENT
UID:lunch@proton.me
DTSTAMP:20261001T120000Z
DTSTART:20261029T120000Z
DURATION:PT45M
SUMMARY:Lunch
END:VEVENT
`
    : ''
}END:VCALENDAR
`;

// A fetch that answers with `respond(url)`: a feed's text, or a Response.
function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const answer = await respond(url);
    return answer instanceof Response ? answer : new Response(answer, { headers: { 'content-type': 'text/calendar' } });
  };
  return { fetch, calls };
}

async function setUp(respond = () => feed(), links = calendarLinks(LINK)) {
  const server = makeServer();
  const { fetch, calls } = fakeFetch((url) => respond(url));
  const reader = createCalendarReader(server, links, { fetch });
  const phone = makeDevice(server);
  return { server, reader, phone, calls };
}

const titles = (device, date) => device.queries.dayEvents(date).map((e) => e.title);
const logged = (server, tbl) => server.core.db.all('SELECT row, col, value FROM messages WHERE tbl = ? ORDER BY seq', [tbl]);

describe('calendars from feeds', () => {
  it('reach every device, each event on its days', async () => {
    const { reader, phone } = await setUp();
    expect(await reader.refresh()).toEqual([{ id: expect.stringMatching(/^cal-/), name: 'Work', error: null, changes: 6 }]);
    await phone.sync();

    expect(phone.queries.calendars()).toEqual([
      { id: expect.any(String), name: 'Work', error: null, checked_at: expect.any(String), events: 3 },
    ]);
    // 13:00 in Zurich is 11:00 UTC in summer time and 12:00 once the clocks go back (Oct 25).
    expect(phone.queries.dayEvents('2026-10-06')).toEqual([
      {
        id: expect.any(String),
        calendar: 'Work',
        title: 'Group meeting',
        location: 'Room 3.12',
        description: 'Agenda:\nhttps://example.org/agenda',
        url: null,
        allDay: false,
        start: '2026-10-06T11:00:00.000Z',
        end: '2026-10-06T12:00:00.000Z',
      },
    ]);
    expect(phone.queries.dayEvents('2026-10-27').map((e) => [e.start, e.end])).toEqual([['2026-10-27T12:00:00.000Z', '2026-10-27T13:00:00.000Z']]);
    // Skipped, moved a day, and ended by its UNTIL.
    expect(titles(phone, '2026-10-13')).toEqual([]);
    expect(titles(phone, '2026-10-20')).toEqual([]);
    expect(titles(phone, '2026-10-21')).toEqual(['Group meeting (moved)']);
    expect(titles(phone, '2026-11-03')).toEqual(['Group meeting']);
    expect(titles(phone, '2026-11-10')).toEqual([]);
    // All-day events first; the conference is on both its days.
    expect(titles(phone, '2026-10-28')).toEqual(['Conference']);
    expect(titles(phone, '2026-10-29')).toEqual(['Conference', 'Lunch']);
    expect(titles(phone, '2026-10-30')).toEqual([]);
  });

  it('write only what changed, in place of what it replaces', async () => {
    const { server, reader, phone } = await setUp();
    await reader.refresh();
    const events = logged(server, 'events');
    // Read again (Proton stamps each read anew): nothing about the events changes.
    expect((await reader.refresh())[0].changes).toBe(0);
    expect(logged(server, 'events')).toEqual(events);
    expect(logged(server, 'calendars').filter((m) => m.col === 'checked_at')).toHaveLength(1);
    await phone.sync();

    // The meeting renamed and the lunch gone.
    const reread = createCalendarReader(server, calendarLinks(LINK), { fetch: fakeFetch(() => feed({ meeting: 'Team meeting', lunch: false })).fetch });
    expect((await reread.refresh())[0].changes).toBe(3);
    await phone.sync();
    expect(titles(phone, '2026-10-06')).toEqual(['Team meeting']);
    expect(titles(phone, '2026-10-29')).toEqual(['Conference']);
    expect(phone.queries.calendars()[0].events).toBe(2);
    // The lunch's details leave the log; its row stays, deleted.
    expect(logged(server, 'events').filter((m) => m.row.endsWith('/lunch@proton.me'))).toEqual([
      expect.objectContaining({ col: 'calendar' }),
      expect.objectContaining({ col: 'deleted', value: 'true' }),
      expect.objectContaining({ col: 'data', value: 'null' }),
    ]);
  });

  it('keep their events when a calendar can’t be read, and say why', async () => {
    let answer = () => feed();
    const { reader, phone } = await setUp(() => answer());
    await reader.refresh();

    answer = () => new Response('Not found', { status: 404, statusText: 'Not Found' });
    expect((await reader.refresh())[0]).toMatchObject({ name: 'Work', error: 'calendar.proton.me answered 404 (Not Found).' });
    await phone.sync();
    expect(phone.queries.calendars()[0]).toMatchObject({ name: 'Work', error: 'calendar.proton.me answered 404 (Not Found).', events: 3 });
    expect(titles(phone, '2026-10-29')).toEqual(['Conference', 'Lunch']);

    answer = () => '<html><body>Sign in</body></html>';
    expect((await reader.refresh())[0].error).toBe("It isn't a calendar.");
    answer = () => {
      throw new TypeError('fetch failed');
    };
    expect((await reader.refresh())[0].error).toBe("Couldn't reach calendar.proton.me.");

    answer = () => feed();
    expect((await reader.refresh())[0].error).toBe(null);
    await phone.sync();
    expect(phone.queries.calendars()[0].error).toBe(null);
  });

  it('leave every device once their link is taken out', async () => {
    const { server, reader, phone } = await setUp();
    await reader.refresh();
    await phone.sync();
    expect(titles(phone, '2026-10-29')).toHaveLength(2);

    await createCalendarReader(server, calendarLinks('')).refresh();
    await phone.sync();
    expect(phone.queries.calendars()).toEqual([]);
    expect(titles(phone, '2026-10-29')).toEqual([]);
  });

  it('keep the link itself on the server', async () => {
    const { server, reader, calls } = await setUp();
    await reader.refresh();
    expect(calls).toEqual([LINK]);
    const all = server.core.db.all('SELECT row, value FROM messages').map((m) => `${m.row} ${m.value}`).join('\n');
    expect(all).not.toContain('secret');
    expect(all).not.toContain('PassphraseKey');
  });

  it('come from the links in ALMANAC_CALENDARS', () => {
    const links = calendarLinks(`${LINK},
      webcal://example.org/team.ics   not-a-link`);
    expect(links.map(({ url, host, error }) => ({ url, host, error }))).toEqual([
      { url: LINK, host: 'calendar.proton.me', error: null },
      { url: 'https://example.org/team.ics', host: 'example.org', error: null },
      { url: null, host: null, error: "The link in ALMANAC_CALENDARS isn't a web address." },
    ]);
    expect(new Set(links.map((l) => l.id)).size).toBe(3);
    expect(calendarLinks(LINK)[0].id).toBe(links[0].id);
  });
});

describe('when events happen', () => {
  let tz;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  const event = (lines) =>
    [...parseFeed(`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:e\n${lines.join('\n')}\nEND:VEVENT\nEND:VCALENDAR\n`).events.values()][0];
  const days = (data, from, to) => occurrences(data, from, to).map((o) => (o.allDay ? o.start : new Date(o.start).toString().slice(0, 21)));

  it('is in the device’s own time zone', () => {
    // 08:00 in Zurich is 23:00 the evening before in Los Angeles.
    const data = event(['DTSTART;TZID=Europe/Zurich:20261102T080000', 'DTEND;TZID=Europe/Zurich:20261102T090000', 'SUMMARY:Call']);
    expect(days(data, '2026-11-01', '2026-11-02')).toEqual(['Sun Nov 01 2026 23:00']);
    expect(days(data, '2026-11-02', '2026-11-03')).toEqual([]);
    // A floating time is the device's own.
    expect(days(event(['DTSTART:20261102T080000', 'SUMMARY:Run']), '2026-11-02', '2026-11-03')).toEqual(['Mon Nov 02 2026 08:00']);
  });

  it('is read in a zone the feed defines, when it isn’t an IANA one', () => {
    const { events } = parseFeed(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:e
DTSTART;TZID=W. Europe Standard Time:20261102T080000
DTEND;TZID=W. Europe Standard Time:20261102T090000
SUMMARY:Call
END:VEVENT
END:VCALENDAR
`);
    const data = events.get('e');
    expect(data).toMatchObject({ tz: 'UTC', start: '2026-11-02T07:00:00', length: 3600 });
    expect(occurrences(data, '2026-11-01', '2026-11-02').map((o) => o.start)).toEqual(['2026-11-02T07:00:00.000Z']);
  });

  it('keeps a changed occurrence’s zone, without the event it belongs to', () => {
    const { events } = parseFeed(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:e
RECURRENCE-ID;TZID=Europe/Zurich:20261102T080000
DTSTART;TZID=Europe/Zurich:20261102T100000
DTEND;TZID=Europe/Zurich:20261102T110000
SUMMARY:Call, moved
END:VEVENT
BEGIN:VEVENT
UID:f
DTSTART;TZID=Europe/Zurich:20261102T080000
RRULE:FREQ=DAILY;COUNT=3
EXDATE;VALUE=DATE:20261103
SUMMARY:Call
END:VEVENT
END:VCALENDAR
`);
    expect(occurrences(events.get('e'), '2026-11-02', '2026-11-03').map((o) => [o.title, o.start])).toEqual([['Call, moved', '2026-11-02T09:00:00.000Z']]);
    expect(occurrences(events.get('f'), '2026-11-01', '2026-11-05').map((o) => o.start)).toEqual(['2026-11-02T07:00:00.000Z', '2026-11-04T07:00:00.000Z']);
  });

  it('repeats by its rule, however long ago it began', () => {
    const daily = event(['DTSTART;TZID=America/New_York:20160101T090000', 'DURATION:PT15M', 'RRULE:FREQ=DAILY', 'SUMMARY:Standup']);
    expect(daily.last).toBe(null);
    expect(days(daily, '2026-10-29', '2026-10-31')).toEqual(['Thu Oct 29 2026 06:00', 'Fri Oct 30 2026 06:00']);
    // Back to an earlier day, from what was worked out already.
    expect(days(daily, '2017-03-01', '2017-03-02')).toEqual(['Wed Mar 01 2017 06:00']);

    const monthly = event(['DTSTART;VALUE=DATE:20260113', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=12', 'SUMMARY:Rent']);
    expect(days(monthly, '2026-11-01', '2026-12-01')).toEqual(['2026-11-10']);
    expect(days(monthly, '2027-01-01', '2027-02-01')).toEqual([]);
    expect(monthly.last).toBe('2026-12-11');
  });

  it('reads as a time on the day', () => {
    const at = (start, end) => ({ allDay: false, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    const time = (local) => timeOfDay(new Date(local).toISOString());
    expect(eventTime({ allDay: true, start: '2026-10-29', end: '2026-10-30' }, '2026-10-29')).toBe('All day');
    expect(eventTime(at('2026-10-29T22:00', '2026-10-29T22:00'), '2026-10-29')).toBe(time('2026-10-29T22:00'));
    expect(eventTime(at('2026-10-29T22:00', '2026-10-30T02:00'), '2026-10-29')).toBe(`From ${time('2026-10-29T22:00')}`);
    expect(eventTime(at('2026-10-29T22:00', '2026-10-30T02:00'), '2026-10-30')).toBe(`Until ${time('2026-10-30T02:00')}`);
    expect(eventTime(at('2026-10-28T22:00', '2026-10-30T02:00'), '2026-10-29')).toBe('All day');
    expect(eventTime(at('2026-10-29T09:00', '2026-10-29T10:30'), '2026-10-29')).toMatch(/9\D*00.*10\D*30/);
  });
});
