import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { NOTE_BOX, journalId } from '@almanac/shared';
import { appendParagraph, editBody, makeDevice, makeServer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const T = Date.parse('2026-10-01T12:00:00Z');
const day = journalId('2026-10-01');
const bytes = (n) => Uint8Array.from({ length: 64 }, (_, i) => (i * n) % 256);

// An image block, as the editor stores it, at the end of `parent`.
function appendImage(parent, file) {
  const image = new Y.XmlElement('image');
  image.setAttribute('file', file);
  parent.push([image]);
}

// Takes the image blocks showing `file` out of a body, notes boxes included.
function removeImages(fragment, file) {
  for (const parent of [fragment, ...fragment.toArray().filter((n) => n instanceof Y.XmlElement && n.nodeName === NOTE_BOX)]) {
    for (let i = parent.length - 1; i >= 0; i--) {
      const node = parent.get(i);
      if (node instanceof Y.XmlElement && node.nodeName === 'image' && node.getAttribute('file') === file) parent.delete(i, 1);
    }
  }
}

// How many of the server's logged changes still carry `file`'s bytes.
const loggedBytes = (server, file) =>
  server.core.db.get("SELECT COUNT(*) AS n FROM messages WHERE tbl = 'files' AND row = ? AND col = 'data' AND value != 'null'", [file]).n;

async function setUp() {
  const server = makeServer();
  const laptop = makeDevice(server);
  const phone = makeDevice(server);
  laptop.actions.ensureJournal('2026-10-01');
  laptop.actions.addFile('plot', 'image/png', bytes(3));
  laptop.actions.addFile('boxed', 'image/png', bytes(5));
  editBody(laptop, day, (fragment) => {
    appendParagraph(fragment, 'The fit:');
    appendImage(fragment, 'plot');
    const box = new Y.XmlElement(NOTE_BOX);
    fragment.push([box]);
    appendImage(box, 'boxed');
  });
  await laptop.sync();
  await phone.sync();
  return { server, laptop, phone };
}

describe('image files no note shows', () => {
  it('are removed after 30 days, from the server, its log and every device', async () => {
    const { server, laptop, phone } = await setUp();
    expect(phone.queries.file('plot')?.bytes).toEqual(bytes(3));
    expect(server.removeUnusedFiles({ now: T })).toEqual([]);

    editBody(laptop, day, (fragment) => removeImages(fragment, 'plot'));
    await laptop.sync();
    expect(server.removeUnusedFiles({ now: T + DAY })).toEqual([]);
    expect(server.removeUnusedFiles({ now: T + 30 * DAY })).toEqual([]);
    expect(server.removeUnusedFiles({ now: T + 31 * DAY })).toEqual(['plot']);
    expect(server.removeUnusedFiles({ now: T + 32 * DAY })).toEqual([]);

    expect(server.core.db.get("SELECT data FROM files WHERE id = 'plot'").data).toBeNull();
    expect(loggedBytes(server, 'plot')).toBe(0);
    expect(loggedBytes(server, 'boxed')).toBe(1);
    await phone.sync();
    expect(phone.queries.file('plot')).toBeNull();
    // The one in a notes box is still shown, so it stays.
    expect(phone.queries.file('boxed')?.bytes).toEqual(bytes(5));
    // A device new to the server never gets the removed file's bytes at all.
    const tablet = makeDevice(server);
    await tablet.sync();
    expect(tablet.queries.file('plot')).toBeNull();
    expect(tablet.queries.file('boxed')?.bytes).toEqual(bytes(5));
  });

  it('start their 30 days again when a note shows them in the meantime', async () => {
    const { server, laptop } = await setUp();
    editBody(laptop, day, (fragment) => removeImages(fragment, 'plot'));
    await laptop.sync();
    server.removeUnusedFiles({ now: T });
    // Undone, or pasted back.
    editBody(laptop, day, (fragment) => appendImage(fragment, 'plot'));
    await laptop.sync();
    expect(server.removeUnusedFiles({ now: T + 10 * DAY })).toEqual([]);
    editBody(laptop, day, (fragment) => removeImages(fragment, 'plot'));
    await laptop.sync();
    expect(server.removeUnusedFiles({ now: T + 20 * DAY })).toEqual([]);
    expect(server.removeUnusedFiles({ now: T + 45 * DAY })).toEqual([]);
    expect(server.removeUnusedFiles({ now: T + 50 * DAY })).toEqual(['plot']);
  });

  it('come back from a device whose notes, written offline, show them again', async () => {
    const { server, laptop, phone } = await setUp();
    editBody(laptop, day, (fragment) => removeImages(fragment, 'plot'));
    await laptop.sync();
    // Offline all along, the phone puts the image in again, as a pasted copy of it would.
    editBody(phone, day, (fragment) => appendImage(fragment, 'plot'));
    server.removeUnusedFiles({ now: T });
    expect(server.removeUnusedFiles({ now: T + 31 * DAY })).toEqual(['plot']);

    await phone.sync();
    expect(phone.queries.file('plot')?.bytes).toEqual(bytes(3));
    expect(server.core.db.get("SELECT data FROM files WHERE id = 'plot'").data).not.toBeNull();
    await laptop.sync();
    expect(laptop.queries.file('plot')?.bytes).toEqual(bytes(3));
    expect(server.removeUnusedFiles({ now: T + 62 * DAY })).toEqual([]);
  });
});
