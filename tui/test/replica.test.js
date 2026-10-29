import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDate } from '@almanac/shared';
import { addTask, dayReport, describeTask } from '../src/commands.js';
import { askRunning, serveControl } from '../src/control.js';
import { ReadOnlyError, openReplica, takeLock } from '../src/replica.js';
import { fetchFrom, makeDevice, makeServer, tempPaths } from './helpers.js';

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});
const paths = () => {
  const p = tempPaths();
  cleanups.push(p.done);
  return p;
};
const replicaOf = (options) => {
  const replica = openReplica(options);
  if (replica) cleanups.push(() => replica.close());
  return replica;
};

describe('the lock on a copy', () => {
  it('is held by one process at a time and let go when closed', () => {
    const p = paths();
    fs.mkdirSync(p.dir, { recursive: true });
    const lock = takeLock(p.lock);
    expect(lock).not.toBeNull();
    expect(takeLock(p.lock)).toBeNull();
    lock.close();
    const again = takeLock(p.lock);
    expect(again).not.toBeNull();
    again.close();
  });
});

describe("this machine's copy", () => {
  it('saves writes at once and sends them to the server, where other devices get them', async () => {
    const p = paths();
    const server = makeServer();
    const replica = replicaOf({ paths: p, server: 'http://almanac.test', fetch: fetchFrom(server) });
    expect(replica.status).toMatchObject({ readOnly: false, pending: 0 });

    const id = replica.act('captureTask', { title: 'submit abstract', category: 'paper' });
    expect(replica.queries.task(id)).toMatchObject({ title: 'submit abstract', category: 'paper' });
    expect(replica.status.pending).toBeGreaterThan(0);

    const status = await replica.sync();
    expect(status).toMatchObject({ online: true, error: null, pending: 0, syncing: false });
    expect(status.lastSync).not.toBeNull();

    const browser = makeDevice(server);
    await browser.sync();
    expect(browser.queries.task(id)).toMatchObject({ title: 'submit abstract', category: 'paper' });

    // And the other way: what the browser writes arrives here.
    browser.actions.updateItem(id, { title: 'submit the abstract' });
    await browser.sync();
    const changes = vi.fn();
    replica.subscribe(changes);
    await replica.sync();
    expect(replica.queries.task(id).title).toBe('submit the abstract');
    expect(changes).toHaveBeenCalled();
  });

  it('keeps its changes while the server is out of reach, and says so', async () => {
    const p = paths();
    const offline = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    };
    const replica = replicaOf({ paths: p, server: 'http://almanac.test', fetch: offline });
    replica.act('captureTask', { title: 'call the dentist' });
    const status = await replica.sync();
    expect(status).toMatchObject({ online: false, reason: 'ECONNREFUSED', error: null });
    expect(status.pending).toBeGreaterThan(0);
  });

  it('reports what the server answered when it refuses a sync', async () => {
    const p = paths();
    const refuse = async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad cursor' }) });
    const replica = replicaOf({ paths: p, server: 'http://almanac.test', fetch: refuse });
    const status = await replica.sync();
    expect(status).toMatchObject({ online: true, error: 'Server answered 400: bad cursor' });
  });

  it('says there is no server to sync with before one is set', async () => {
    const replica = replicaOf({ paths: paths(), server: null });
    expect(await replica.sync()).toMatchObject({ online: false, reason: 'No server set' });
  });

  it('opens read-only while another process has it, shows that process’s writes, and takes over when it’s gone', async () => {
    const p = paths();
    const first = replicaOf({ paths: p, server: null });
    const second = replicaOf({ paths: p, server: null });
    expect(second.status.readOnly).toBe(true);
    expect(() => second.act('captureTask', { title: 'nope' })).toThrow(ReadOnlyError);
    expect(openReplica({ paths: p, server: null, requireLock: true })).toBeNull();

    second.start();
    const changes = vi.fn();
    second.subscribe(changes);
    const id = first.act('captureTask', { title: 'written by the first' });
    await vi.waitFor(() => expect(changes).toHaveBeenCalled(), { timeout: 3000 });
    expect(second.queries.task(id).title).toBe('written by the first');

    const statuses = [];
    second.onStatus((s) => statuses.push(s.readOnly));
    first.close();
    await vi.waitFor(() => expect(second.status.readOnly).toBe(false), { timeout: 3000 });
    expect(statuses).toContain(false);
    const mine = second.act('captureTask', { title: 'written by the second' });
    expect(second.queries.task(mine).title).toBe('written by the second');
  });

  it('won’t open read-only while the other process is still making the copy', () => {
    const p = paths();
    fs.mkdirSync(p.dir, { recursive: true });
    const lock = takeLock(p.lock);
    cleanups.push(() => lock.close());
    expect(() => openReplica({ paths: p, server: null })).toThrow(/setting up its copy/);
  });
});

describe('adding a task from a line', () => {
  it('reads the line as the web’s task box does, matching a category in use whatever its case', () => {
    const replica = replicaOf({ paths: paths(), server: null });
    replica.act('captureTask', { title: 'referee report', category: 'Paper' });
    const task = addTask(replica, 'submit abstract #paper');
    expect(task).toMatchObject({ title: 'submit abstract', category: 'Paper', due: null, isNew: false });
    expect(replica.queries.task(task.id)).toMatchObject({ title: 'submit abstract', category: 'Paper' });
    expect(addTask(replica, 'water the plants #home')).toMatchObject({ category: 'home', isNew: true });
  });

  it('gives it the day’s date when the line has none, and the line’s when it does', () => {
    const replica = replicaOf({ paths: paths(), server: null });
    expect(addTask(replica, 'send slides', '2026-11-02').due).toBe('2026-11-02');
    expect(addTask(replica, 'send slides tomorrow', '2026-11-02').due).not.toBe('2026-11-02');
  });

  it('refuses a line with no title', () => {
    const replica = replicaOf({ paths: paths(), server: null });
    expect(() => addTask(replica, '#paper')).toThrow(/needs a title/);
  });

  it('describes what it added, and reports a day as plain data', () => {
    const today = localDate();
    expect(describeTask({ title: 'submit abstract', due: null, category: 'paper' }, today)).toBe('submit abstract · paper');
    const replica = replicaOf({ paths: paths(), server: null });
    const id = replica.act('captureTask', { title: 'send slides', due: today });
    const report = dayReport(replica.queries, today);
    expect(report).toMatchObject({ date: today, overdue: [], finished: [] });
    expect(report.due).toEqual([{ id, title: 'send slides', status: 'open', due: today, category: null, subtasks: 0, subtasks_done: 0 }]);
  });
});

describe('the socket other commands reach the TUI by', () => {
  it('answers a request with what the handler returns, or the error it throws', async () => {
    const p = paths();
    fs.mkdirSync(p.dir, { recursive: true });
    const control = serveControl(p.socket, async (request) => {
      if (request.cmd === 'fail') throw new Error('Unknown request fail');
      return { echoed: request.text };
    });
    cleanups.push(() => control.close());
    await expect(askRunning(p.socket, { cmd: 'add', text: 'hello' })).resolves.toEqual({ echoed: 'hello' });
    await expect(askRunning(p.socket, { cmd: 'fail' })).rejects.toThrow('Unknown request fail');
  });

  it('takes over a socket left behind, and is gone once closed', async () => {
    const p = paths();
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.socket, '');
    const control = serveControl(p.socket, async () => 'ok');
    await expect(askRunning(p.socket, {})).resolves.toBe('ok');
    control.close();
    expect(fs.existsSync(p.socket)).toBe(false);
    await expect(askRunning(p.socket, {})).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
