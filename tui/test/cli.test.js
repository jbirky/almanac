import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, localDate, shortDay } from '@almanac/shared';
import { addTask } from '../src/commands.js';
import { serveControl } from '../src/control.js';
import { openReplica } from '../src/replica.js';
import { makeDevice, serveHttp, tempPaths } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});
const paths = () => {
  const p = tempPaths();
  cleanups.push(p.done);
  return p;
};
const serve = async () => {
  const http = await serveHttp();
  cleanups.push(http.close);
  return http;
};

// Runs `almanac` with its copy and settings in `p`, as { code, stdout, stderr }.
function almanac(p, ...args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, ...p.env, HOME: p.root, FORCE_COLOR: '0' }, timeout: 30_000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

describe('almanac from the shell', () => {
  it('says how to start when it doesn’t know the server or has no copy yet', async () => {
    const p = paths();
    const add = await almanac(p, 'add', 'call the dentist');
    expect(add.code).toBe(1);
    expect(add.stderr).toContain('Almanac doesn’t know your server yet. Run it once with --server <address>');
    const today = await almanac(p, 'today');
    expect(today.code).toBe(1);
    expect(today.stderr).toContain('There’s no copy on this machine yet.');
    const unknown = await almanac(p, 'frobnicate');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Unknown command “frobnicate”');
    expect((await almanac(p, '--help')).stdout).toContain('almanac add "<text>"');
  });

  it('checks a server answers before keeping its address', async () => {
    const p = paths();
    const result = await almanac(p, '--server', 'http://127.0.0.1:9', 'sync');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Couldn’t use http://127.0.0.1:9.');
    expect(fs.existsSync(p.config)).toBe(false);
  });

  it('adds a task as the task box reads it, and sends it to the server', async () => {
    const p = paths();
    const http = await serve();
    const today = localDate();
    const result = await almanac(p, '--server', http.url, 'add', 'water the plants tomorrow #home');
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.trim()).toBe(`Added water the plants · due ${shortDay(addDays(today, 1), today)} · home (a new category)`);
    expect(JSON.parse(fs.readFileSync(p.config, 'utf8')).server).toBe(http.url);

    const browser = makeDevice(http.server);
    await browser.sync();
    expect(browser.queries.openTasks().map((t) => [t.title, t.category, t.due])).toEqual([['water the plants', 'home', addDays(today, 1)]]);
  });

  it('reports the day, as text or JSON, and syncs on request', async () => {
    const p = paths();
    const http = await serve();
    await almanac(p, '--server', http.url, 'add', 'send slides today');
    await almanac(p, 'add', 'referee report #paper');

    const text = await almanac(p, 'today');
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^Due today\n {2}\[ \] send slides\n$/);
    const json = JSON.parse((await almanac(p, 'today', '--json')).stdout);
    expect(json).toMatchObject({ date: localDate(), overdue: [], finished: [] });
    expect(json.due.map((t) => t.title)).toEqual(['send slides']);

    expect(await almanac(p, 'sync')).toMatchObject({ code: 0, stdout: 'Synced. Nothing waiting.\n' });
  });

  it('keeps a task when the server is out of reach, and says it goes out with the next sync', async () => {
    const p = paths();
    const http = await serveHttp();
    await almanac(p, '--server', http.url, 'sync');
    await http.close();
    const add = await almanac(p, 'add', 'call the dentist');
    expect(add.code).toBe(0);
    expect(add.stdout).toContain('It’s saved on this machine, and goes to the server with the next sync.');
    const sync = await almanac(p, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stderr).toMatch(/^Couldn’t reach http:\/\/127\.0\.0\.1:\d+ \(ECONNREFUSED\)\. \d+ changes? (is|are) waiting\./);
  });

  it('hands its work to the TUI that has the copy open', async () => {
    const p = paths();
    const http = await serve();
    await almanac(p, '--server', http.url, 'sync');
    // A TUI, as far as the shell can tell: it holds the copy and answers on its socket.
    const tui = openReplica({ paths: p, server: http.url });
    const control = serveControl(p.socket, async (request) => {
      if (request.cmd === 'add') return { task: addTask(tui, request.text) };
      if (request.cmd === 'sync') return { status: await tui.sync() };
      throw new Error(`Unknown request ${request.cmd}`);
    });
    cleanups.push(() => {
      control.close();
      tui.close();
    });

    const add = await almanac(p, 'add', 'call the dentist #errands');
    expect(add).toMatchObject({ code: 0, stdout: 'Added call the dentist · errands (a new category)\n' });
    expect(tui.queries.openTasks().map((t) => t.title)).toEqual(['call the dentist']);
    expect(await almanac(p, 'sync')).toMatchObject({ code: 0, stdout: 'Synced. Nothing waiting.\n' });
    // And today reads the copy while the TUI has it.
    expect((await almanac(p, 'today')).stdout).toBe('Nothing due today.\n');
  });
});
