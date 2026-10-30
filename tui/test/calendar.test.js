import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDate } from '@almanac/shared';
import { calendarLinks, createCalendarReader } from '../../server/src/calendars.js';
import { ReplicaContext } from '../src/hooks.js';
import { openReplica } from '../src/replica.js';
import { makeTheme } from '../src/theme.js';
import { App } from '../src/views/App.js';
import { FakeStdin, FakeStdout, fetchFrom, makeServer, serveHttp, tempPaths } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '');

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

// A server reading a calendar with two events today: an all-day one, and a meeting at 9:00 in
// the device's own time (a floating time).
async function serverWithCalendar() {
  const today = localDate().replaceAll('-', '');
  const feed = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Work
BEGIN:VEVENT
UID:meeting
DTSTART:${today}T090000
DTEND:${today}T100000
SUMMARY:Group meeting
LOCATION:Room 3.12
END:VEVENT
BEGIN:VEVENT
UID:retreat
DTSTART;VALUE=DATE:${today}
SUMMARY:Retreat
END:VEVENT
END:VCALENDAR
`;
  const server = makeServer();
  const fetch = async () => new Response(feed);
  await createCalendarReader(server, calendarLinks('https://calendar.proton.me/feed.ics'), { fetch }).refresh();
  return server;
}

describe('calendar events in the terminal', () => {
  it('show on the day, above its Due panel', async () => {
    const server = await serverWithCalendar();
    const paths = tempPaths();
    cleanups.push(paths.done);
    const replica = openReplica({ paths, server: 'http://almanac.test', fetch: fetchFrom(server) });
    cleanups.push(() => replica.close());
    await replica.sync();

    const stdout = new FakeStdout(120, 36);
    const ink = render(h(ReplicaContext.Provider, { value: replica }, h(App, { theme: makeTheme(), paths })), {
      stdout,
      stdin: new FakeStdin(),
      stderr: new FakeStdout(),
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    cleanups.push(() => ink.unmount());
    const frame = () => plain(stdout.lastFrame());
    await vi.waitFor(() => expect(frame()).toContain('Events today'), { timeout: 2000 });
    const lines = frame().split('\n');
    const at = (text) => lines.findIndex((l) => l.includes(text));
    expect(lines[at('Retreat')]).toMatch(/All day\s+Retreat/);
    expect(lines[at('Group meeting')]).toMatch(/9:00\D+10:00\D*\s+Group meeting · Room 3\.12/);
    expect(at('Retreat')).toBeLessThan(at('Group meeting'));
    expect(at('Group meeting')).toBeLessThan(at('Due today'));
  });

  it('are listed by almanac today, and in its JSON', async () => {
    const http = await serveHttp(await serverWithCalendar());
    cleanups.push(http.close);
    const paths = tempPaths();
    cleanups.push(paths.done);
    const almanac = (...args) =>
      new Promise((resolve) => {
        execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...paths.env, HOME: paths.root, FORCE_COLOR: '0' } }, (err, stdout) =>
          resolve({ code: err ? (err.code ?? 1) : 0, stdout }),
        );
      });
    expect((await almanac('--server', http.url, 'sync')).code).toBe(0);

    const text = await almanac('today');
    expect(text.stdout).toMatch(/^Events today\n {2}All day\s+Retreat\n {2}9:00\D+10:00\D*\s+Group meeting · Room 3\.12\n$/);
    const json = JSON.parse((await almanac('today', '--json')).stdout);
    expect(json.events).toEqual([
      { title: 'Retreat', location: null, allDay: true, start: localDate(), end: expect.any(String), calendar: 'Work' },
      { title: 'Group meeting', location: 'Room 3.12', allDay: false, start: expect.any(String), end: expect.any(String), calendar: 'Work' },
    ]);
  });
});
