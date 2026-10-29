import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { adaptBetterSqlite, createCore, localDate } from '@almanac/shared';
import { appendParagraph, bodyText, editBody, makeDevice, makeServer } from './helpers.js';

describe('sync between devices', () => {
  it('delivers a task created on one device to another', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);

    const id = laptop.actions.createItem({ type: 'task', title: 'Rerun light curve fits' });
    await laptop.sync();
    await phone.sync();

    expect(phone.queries.task(id)).toMatchObject({ title: 'Rerun light curve fits', status: 'open' });
    expect(laptop.core.outboxCount()).toBe(0);
  });

  it('keeps offline edits to different fields of the same task', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const id = laptop.actions.createItem({ type: 'task', title: 'Draft intro' });
    await laptop.sync();
    await phone.sync();

    laptop.actions.updateItem(id, { title: 'Draft intro section' });
    phone.actions.updateItem(id, { due: '2026-10-20' });
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    for (const device of [laptop, phone]) {
      expect(device.queries.task(id)).toMatchObject({ title: 'Draft intro section', due: '2026-10-20' });
    }
  });

  it('resolves offline edits to the same field by the later timestamp, whatever the sync order', async () => {
    const server = makeServer();
    const laptop = makeDevice(server, 1_000_000);
    const phone = makeDevice(server, 1_000_000);
    const id = laptop.actions.createItem({ type: 'task', title: 'original' });
    await laptop.sync();
    await phone.sync();

    laptop.tick(1_000);
    laptop.actions.updateItem(id, { title: 'earlier edit' });
    phone.tick(5_000);
    phone.actions.updateItem(id, { title: 'later edit' });
    // The later edit reaches the server first.
    await phone.sync();
    await laptop.sync();
    await phone.sync();

    expect(laptop.queries.task(id).title).toBe('later edit');
    expect(phone.queries.task(id).title).toBe('later edit');
  });

  it('merges offline edits to the same journal day', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const noteId = laptop.actions.ensureJournal(localDate());
    editBody(laptop, noteId, (f) => appendParagraph(f, 'Agenda'));
    await laptop.sync();
    await phone.sync();

    editBody(laptop, noteId, (f) => appendParagraph(f, 'alpha from laptop'));
    editBody(phone, noteId, (f) => appendParagraph(f, 'beta from phone'));
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    const text = bodyText(laptop, noteId);
    expect(text).toContain('Agenda');
    expect(text).toContain('alpha from laptop');
    expect(text).toContain('beta from phone');
    expect(bodyText(phone, noteId)).toBe(text);
    expect(laptop.queries.search('beta').map((r) => r.date)).toEqual([localDate()]);
  });

  it('ignores a change pushed twice', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    laptop.actions.createItem({ type: 'task', title: 'once' });
    const pending = laptop.core.outbox().map(({ id, ...m }) => m);

    server.sync({ messages: pending, cursor: 0 });
    const again = server.sync({ messages: pending, cursor: 0 });

    expect(again.messages).toHaveLength(pending.length);
  });

  it('does not let a late-arriving older change overwrite a newer one', () => {
    const device = makeDevice(makeServer());
    const id = 'aaaaaaaaaaaaaaaaaaaa';
    const node = 'cccccccccccccccc';
    const newer = { hlc: `2026-10-14T12:00:00.000Z-0000-${node}`, tbl: 'items', row: id, col: 'title', value: '"newer"' };
    const older = { hlc: `2026-10-14T11:00:00.000Z-0000-${node}`, tbl: 'items', row: id, col: 'title', value: '"older"' };

    device.core.receive([newer]);
    device.core.receive([older]);

    expect(device.db.get('SELECT title FROM items WHERE id = ?', [id]).title).toBe('newer');
  });
});

describe('images', () => {
  const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256);

  it('syncs an image to another device, byte for byte', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const plot = bytes(5000, 7);

    laptop.actions.addFile('img1', 'image/png', plot);
    await laptop.sync();
    expect(phone.queries.file('img1')).toBeNull();
    await phone.sync();

    const file = phone.queries.file('img1');
    expect(file.type).toBe('image/png');
    expect([...file.bytes]).toEqual([...plot]);
  });

  it("doesn't send an image again that the device already has", () => {
    const laptop = makeDevice(makeServer());
    laptop.actions.addFile('img1', 'image/png', bytes(10, 1));
    const queued = laptop.core.outboxCount();
    laptop.actions.addFile('img1', 'image/png', bytes(10, 1));
    expect(laptop.core.outboxCount()).toBe(queued);
  });

  it('sends and pulls large images a few at a time', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    // Six of 3.5 MB (4.7 MB in base64): three fit in a 16 MB batch.
    const big = bytes(3.5 * 1024 * 1024, 3);
    for (let i = 0; i < 6; i++) laptop.actions.addFile(`img${i}`, 'image/webp', big);
    const batches = laptop.core.outbox(500, 16 * 1024 * 1024);
    expect(batches.filter((m) => m.col === 'data')).toHaveLength(3);
    await laptop.sync();
    expect(laptop.core.outboxCount()).toBe(0);

    const first = server.sync({ cursor: 0 });
    expect(first.more).toBe(true);
    expect(first.messages.filter((m) => m.col === 'data').length).toBeLessThan(6);
    await phone.sync();
    for (let i = 0; i < 6; i++) expect(phone.queries.file(`img${i}`).bytes.length).toBe(big.length);
  });
});

describe('schema upgrade', () => {
  const typeNames = (db) => db.all('SELECT name FROM types').map((r) => r.name);
  const addType = (device) => device.core.mutate([{ tbl: 'types', row: 'experiment', col: 'name', value: 'Experiment' }]);

  it('pulls the whole log again so changes an older device skipped are applied', async () => {
    const server = makeServer();
    const writer = makeDevice(server);
    addType(writer);
    writer.actions.createItem({ type: 'task', title: 'kept' });
    await writer.sync();

    // An "old" device that synced everything but, under schema 1, kept no `types` rows.
    const raw = new Database(':memory:');
    const old = makeDevice(server, Date.now(), raw);
    await old.sync();
    raw.exec(`DELETE FROM types; DELETE FROM clock WHERE tbl = 'types'; UPDATE meta SET value = '1' WHERE key = 'schema_version'`);
    expect(typeNames(old.db)).toEqual([]);

    // Reopening it with the current code resets the cursor; the next sync replays the log.
    const upgraded = createCore(adaptBetterSqlite(raw));
    expect(upgraded.upgradedFrom).toBe(1);
    expect(upgraded.getMeta('cursor')).toBe('0');
    const reopened = makeDevice(server, Date.now(), raw);
    await reopened.sync();
    expect(typeNames(reopened.db)).toEqual(['Experiment']);
    expect(reopened.queries.openTasks().map((t) => t.title)).toEqual(['kept']);
  });

  it('replays the server log into its own copy after an upgrade', async () => {
    const raw = new Database(':memory:');
    const server = makeServer(raw);
    const d = makeDevice(server);
    addType(d);
    await d.sync();
    raw.exec(`DELETE FROM types; DELETE FROM clock WHERE tbl = 'types'; UPDATE meta SET value = '1' WHERE key = 'schema_version'`);

    const restarted = makeServer(raw);
    expect(typeNames(restarted.core.db)).toEqual(['Experiment']);
  });
});
