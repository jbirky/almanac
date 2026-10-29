import fs from 'node:fs';
import { createElement as h } from 'react';
import * as Y from 'yjs';
import { render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { BODY_FIELD, addDays, fullDay, journalId, localDate, shortDay } from '@almanac/shared';
import { ReplicaContext } from '../src/hooks.js';
import { openReplica } from '../src/replica.js';
import { width } from '../src/text.js';
import { makeTheme } from '../src/theme.js';
import { App } from '../src/views/App.js';
import { FakeStdin, FakeStdout, KEYS, tempPaths, writeDay } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '');

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

// A copy with a day like the design's example: tasks due, overdue and in categories, and a
// journal with a notes box holding a task.
function seededCopy() {
  const paths = tempPaths();
  cleanups.push(paths.done);
  const replica = openReplica({ paths, server: null });
  cleanups.push(() => replica.close());
  const act = (...args) => replica.act(...args);
  const today = localDate();
  const ids = {
    slides: act('captureTask', { title: 'Send slides to the group', due: today }),
    observatory: act('captureTask', { title: 'call the observatory', due: today, category: 'observing' }),
    referee: act('captureTask', { title: 'referee report', due: addDays(today, -2), category: 'paper' }),
    abstract: act('captureTask', { title: 'submit abstract', category: 'paper' }),
    priors: act('captureTask', { title: 'Email the priors', category: 'meeting' }),
  };
  const meeting = act('createLabel', { name: 'meeting', color: 'orange' });
  writeDay(act, today, (body, b) => {
    b.para(body, 'Discussed ', { text: 'priors', marks: { italic: {} } }, ' for the fits.');
    b.box(body, 'box-meeting', meeting, (box) => {
      b.para(box, 'Group meeting with the TESS team');
      b.task(box, ids.priors);
    });
  });
  // The links the web editor keeps from a day to the tasks and labels written in it.
  act('syncBodyLinks', journalId(today), 'embed', [ids.priors]);
  act('syncBodyLinks', journalId(today), 'label', [meeting]);
  return { paths, replica, ids, today };
}

function renderApp(replica, paths, { columns = 120, rows = 36 } = {}) {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const ink = render(h(ReplicaContext.Provider, { value: replica }, h(App, { theme: makeTheme(), paths })), {
    stdout,
    stdin,
    stderr: new FakeStdout(),
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  cleanups.push(() => ink.unmount());
  const frame = () => plain(stdout.lastFrame());
  const lines = () => frame().split('\n');
  // Each key gets a moment for the screen to catch up, as a person's would.
  const press = async (...keys) => {
    for (const key of keys) {
      stdin.write(key);
      await sleep(30);
    }
  };
  const see = (text) => vi.waitFor(() => expect(frame()).toContain(text), { timeout: 2000 });
  // The rows the cursor is on: the task list's, or the journal's.
  const cursorLine = (pane) => lines().find((l) => (pane === 'tasks' ? l.startsWith('▌') : l.includes('│▌'))) ?? '';
  const cursorTo = async (pane, text) => {
    for (let i = 0; i < 40 && !cursorLine(pane).includes(text); i++) await press('j');
    expect(cursorLine(pane)).toContain(text);
  };
  return { frame, lines, press, see, cursorLine, cursorTo };
}

describe('the full-screen app', () => {
  it('draws the day: its Due panel, its journal with the notes box, the task list and the status bar', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    const frame = app.frame();
    for (const text of ['TODAY', 'Send slides to the group', 'Overdue', 'referee report', 'Discussed priors for the fits.', '● meeting', 'Group meeting with the TESS team', 'Email the priors', 'observing', 'paper', 'No category', 'JOURNAL']) {
      expect(frame).toContain(text);
    }
    expect(app.lines()).toHaveLength(36);
    for (const line of app.lines()) expect(width(line)).toBeLessThanOrEqual(120);
  });

  it('adds a task from the task box, showing how it reads first', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press('a');
    await app.see('ADD TASK');
    await app.press('water the plants tomorrow #home');
    await app.see('Tomorrow');
    expect(app.frame()).toMatch(/water the plants\s+Tomorrow\s+home\s+new/);
    await app.press(KEYS.enter);
    await app.see('Added water the plants');
    const added = replica.queries.openTasks().find((t) => t.title === 'water the plants');
    expect(added).toMatchObject({ category: 'home', due: addDays(today, 1) });
    await app.press(KEYS.escape);
    await app.see('TASKS');
  });

  it('checks off, deletes and brings back a task in the list', async () => {
    const { replica, paths, ids } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(KEYS.shiftTab);
    await app.see('TASKS');
    await app.cursorTo('tasks', 'call the observatory');
    await app.press('x');
    await vi.waitFor(() => expect(replica.queries.task(ids.observatory).status).toBe('done'));

    await app.cursorTo('tasks', 'referee report');
    await app.press('D');
    await app.see('Deleted “referee report”. u brings it back.');
    expect(replica.queries.openTasks().map((t) => t.id)).not.toContain(ids.referee);
    await app.press('u');
    await app.see('Brought back “referee report”.');
    expect(replica.queries.openTasks().map((t) => t.id)).toContain(ids.referee);
  });

  it('picks a category and a due date at the task, and adds subtasks under it', async () => {
    const { replica, paths, ids, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(KEYS.shiftTab);
    await app.cursorTo('tasks', 'submit abstract');

    await app.press('c');
    await app.see('Enter picks');
    await app.press('errands');
    await app.see('new category “errands”');
    await app.press(KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.task(ids.abstract).category).toBe('errands'));

    await app.cursorTo('tasks', 'submit abstract');
    await app.press('d');
    await app.see('Enter sets');
    await app.press('tomorrow');
    await app.see('→ ');
    await app.press(KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.task(ids.abstract).due).toBe(addDays(today, 1)));

    await app.press('A');
    await app.see('SUBTASK');
    await app.press('pick the nights', KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.subtasks(ids.abstract).map((s) => s.title)).toEqual(['pick the nights']));
    await app.see('0/1');
    // Which tasks show their subtasks is kept on this machine.
    expect(JSON.parse(fs.readFileSync(paths.state, 'utf8')).openSubtasks).toEqual([ids.abstract]);
  });

  it('moves a category with Alt+↓ on its name, and Home and End go to either end of the list', async () => {
    const { replica, paths, ids } = seededCopy();
    // Short enough that a half page is a row or two, so End can't get there by paging.
    const app = renderApp(replica, paths, { rows: 18 });
    await app.see('JOURNAL');
    await app.press(KEYS.shiftTab, KEYS.end);
    await vi.waitFor(() => expect(app.cursorLine('tasks')).toContain('Send slides to the group'));
    await app.press('x');
    await vi.waitFor(() => expect(replica.queries.task(ids.slides).status).toBe('done'));

    await app.press(KEYS.home);
    await vi.waitFor(() => expect(app.cursorLine('tasks')).toContain('meeting'));
    await app.press(KEYS.altDown);
    await vi.waitFor(() => expect(replica.queries.categoryOrder()).toEqual(['observing', 'meeting', 'paper']));
  });

  it('opens a task’s day from the list with the cursor on the task where it’s written', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(KEYS.shiftTab);
    await app.cursorTo('tasks', 'Email the priors');
    await app.press(KEYS.enter);
    await app.see('JOURNAL');
    await vi.waitFor(() => expect(app.cursorLine('journal')).toContain('Email the priors'));
  });

  it('pins a box to the days after its own, where it shows as the box itself', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.cursorTo('journal', '● meeting');
    await app.press('p');
    await app.see('Pinned.');
    expect(replica.queries.pinnedBoxes(addDays(today, 1))).toHaveLength(1);
    await app.press(']');
    await app.see('TOMORROW');
    expect(app.frame()).toContain('pinned from');
    expect(app.frame()).toContain('Group meeting with the TESS team');
  });

  it('searches the journals and tasks, and opens a matching day', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press('[');
    await app.see('YESTERDAY');
    await app.press('/');
    await app.see('SEARCH');
    await app.press('TESS');
    await app.see('see the days');
    await app.press(KEYS.enter);
    await app.see('Esc clears');
    await vi.waitFor(() => expect(app.cursorLine('tasks')).toContain(shortDay(today, today)));
    await app.press(KEYS.enter);
    await app.see('TODAY');
  });

  it('opens read-only while another terminal has the copy, says why, and can write once it’s gone', async () => {
    const { replica: other, paths } = seededCopy();
    const replica = openReplica({ paths, server: null });
    cleanups.push(() => replica.close());
    replica.start();
    const app = renderApp(replica, paths);
    await app.see('◇ read-only');
    await app.see('Almanac is open in another terminal, so this one can only read.');
    await app.press('a');
    expect(app.frame()).not.toContain('ADD TASK');

    other.close();
    await vi.waitFor(() => expect(app.frame()).toContain('The other terminal closed, so this one can write now.'), { timeout: 4000 });
    expect(app.frame()).not.toContain('read-only');
    await app.press('a');
    await app.see('ADD TASK');
  });

  it('asks for a bigger terminal when it’s too small to draw', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths, { columns: 36, rows: 14 });
    await app.see('Make the terminal at least 40 × 16');
  });

  it('shows one pane at a time when narrow, the journal first, and Tab brings the others over it', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths, { columns: 64, rows: 26 });
    await app.see('Tab calendar, tasks');
    expect(app.frame()).toContain('Discussed priors for the fits.');
    expect(app.frame()).not.toContain('│');
    for (const line of app.lines()) expect(width(line)).toBeLessThanOrEqual(64);
    await app.press(KEYS.tab);
    await app.see('Add a task: "draft intro fri #paper"');
    expect(app.frame()).not.toContain('Discussed priors for the fits.');
    await app.press(KEYS.tab);
    await app.see('TASKS');
    await app.press(KEYS.escape);
    await app.see('Discussed priors for the fits.');
  });
});

// A day's journal as it's stored, once what's waiting has been saved.
function storedDay(replica, date) {
  replica.bodies.flushAll();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, replica.queries.body(journalId(date)));
  return doc.getXmlFragment(BODY_FIELD).toString();
}

describe('writing in the journal', () => {
  it('writes a day from nothing: a paragraph, a notes box, tasks in it, and a line after it', async () => {
    const { replica, paths, today } = seededCopy();
    const tomorrow = addDays(today, 1);
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(']');
    await app.see('Nothing written this day.');
    await app.cursorTo('journal', 'Nothing written this day.');
    await app.press('i');
    await app.see('WRITE');
    await app.press('Notes for **tomorrow**.', KEYS.enter, '#meeting Prep the slides', KEYS.enter, '[] ', 'draft the outline');
    await app.see('draft the outline');
    // Enter in a task's title adds the next; on an empty one, it's a line again, and Enter on an
    // empty last line leaves the box.
    await app.press(KEYS.enter, 'send it round', KEYS.enter, KEYS.enter, KEYS.enter, 'Done.', KEYS.escape);
    await app.see('JOURNAL');
    expect(app.frame()).toContain('Notes for tomorrow.');

    const [outline, round] = ['draft the outline', 'send it round'].map((title) => replica.queries.openTasks().find((t) => t.title === title));
    // Filed under the box's label, which was the existing "meeting" label.
    expect(outline).toMatchObject({ category: 'meeting' });
    expect(round).toMatchObject({ category: 'meeting' });
    const meeting = replica.queries.labels().find((l) => l.name === 'meeting');
    expect(storedDay(replica, tomorrow)).toBe(
      `<paragraph>Notes for <bold>tomorrow</bold>.</paragraph><notebox id="${/id="([^"]+)"/.exec(storedDay(replica, tomorrow).split('<notebox ')[1])[1]}" label="${meeting.id}"><paragraph>Prep the slides</paragraph><taskref id="${outline.id}"></taskref><taskref id="${round.id}"></taskref></notebox><paragraph>Done.</paragraph>`,
    );
    expect(replica.queries.taskDay(outline.id)).toBe(tomorrow);
  });

  it('moves a block into a box, deletes a task where it\'s written, and undoes both', async () => {
    const { replica, paths, ids, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.cursorTo('journal', 'Discussed priors for the fits.');
    await app.press(KEYS.altDown);
    await vi.waitFor(() => expect(app.cursorLine('journal')).toContain('▎ Discussed priors'));
    // Into the box below, at its near end: its top.
    expect(storedDay(replica, today)).toMatch(/^<notebox [^>]*><paragraph>Discussed <italic>priors<\/italic> for the fits.<\/paragraph><paragraph>Group meeting/);

    await app.cursorTo('journal', 'Email the priors');
    await app.press('D');
    await app.see('Deleted “Email the priors”. u brings it back.');
    expect(replica.queries.task(ids.priors)).toMatchObject({ deleted: 1 });
    expect(storedDay(replica, today)).not.toContain('taskref');
    await app.press('u');
    await vi.waitFor(() => expect(replica.queries.task(ids.priors)).toMatchObject({ deleted: 0 }));
    expect(storedDay(replica, today)).toContain(`<taskref id="${ids.priors}">`);
    await app.press('u');
    await vi.waitFor(() => expect(storedDay(replica, today)).toMatch(/^<paragraph>Discussed <italic>priors/));
    await app.press(KEYS.ctrlR);
    await vi.waitFor(() => expect(storedDay(replica, today)).toMatch(/^<notebox/));
  });

  it('shows what another device writes in the same line, keeping the cursor where it was', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.cursorTo('journal', 'Discussed priors for the fits.');
    await app.press('i', ' Mine.');
    await app.see('fits. Mine.');
    replica.bodies.flushAll();

    // Another device adds to the start of the line, and its change arrives.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, replica.queries.body(journalId(today)));
    const before = Y.encodeStateVector(doc);
    doc.getXmlFragment(BODY_FIELD).toArray()[0].toArray()[0].insert(0, 'Theirs. ');
    replica.act('applyBodyUpdate', journalId(today), Y.encodeStateAsUpdate(doc, before));
    await app.see('Theirs. Discussed');
    await app.press('!', KEYS.escape);
    expect(storedDay(replica, today)).toContain('<paragraph>Theirs. Discussed <italic>priors</italic> for the fits. Mine.!</paragraph>');
  });

  it('adds a notes box under a new label with n, and takes it away from its menu', async () => {
    const { replica, paths, today } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.cursorTo('journal', 'Discussed priors for the fits.');
    await app.press('n');
    await app.see('Find or create a label');
    await app.press('lecture');
    await app.see('new label “lecture”');
    await app.press(KEYS.enter, 'Kepler-90 resonances', KEYS.escape);
    await app.see('● lecture');
    const lecture = replica.queries.labels().find((l) => l.name === 'lecture');
    expect(storedDay(replica, today)).toContain(`label="${lecture.id}"><paragraph>Kepler-90 resonances</paragraph></notebox>`);

    // Up from its line to its label.
    await app.press('k');
    expect(app.cursorLine('journal')).toContain('● lecture');
    await app.press(KEYS.enter);
    await app.see('Remove the box, keep its notes');
    expect(app.frame()).toContain('All “lecture” notes, by label');
    // Past the label's own entries and pinning, to removing the box.
    await app.press(KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.enter);
    await vi.waitFor(() => expect(storedDay(replica, today)).not.toContain(lecture.id));
    expect(storedDay(replica, today)).toContain('<paragraph>Kepler-90 resonances</paragraph>');
  });

  it('can\'t write while another terminal has the copy', async () => {
    const { replica: other, paths } = seededCopy();
    const replica = openReplica({ paths, server: null });
    cleanups.push(() => replica.close());
    const app = renderApp(replica, paths);
    await app.see('◇ read-only');
    await app.cursorTo('journal', 'Discussed priors for the fits.');
    await app.press('i');
    expect(app.frame()).not.toContain('WRITE');
    other.close();
  });
});

describe('by label, pinned boxes, formulas and images', () => {
  it('shows a label’s boxes by day, written in there, and steps, adds and renames labels', async () => {
    const { replica, paths, today } = seededCopy();
    replica.act('createLabel', { name: 'lecture' });
    const app = renderApp(replica, paths);
    await app.see('Due today');
    // v from a box goes to its label.
    await app.cursorTo('journal', 'Group meeting with the TESS team');
    await app.press('v');
    await app.see('LABEL');
    expect(app.frame()).toContain('● meeting');
    expect(app.frame()).toContain(`Today · ${fullDay(today, today)}`);
    expect(app.frame()).not.toContain('Discussed priors');
    await app.cursorTo('journal', 'Group meeting with the TESS team');
    await app.press('i', ' (weekly)', KEYS.escape);
    expect(storedDay(replica, today)).toContain('Group meeting with the TESS team (weekly)');

    // The label before it, with no box today: + Add to today starts one.
    await app.press('[');
    await app.see('● lecture');
    await app.cursorTo('journal', '+ Add to today');
    await app.press(KEYS.enter, 'Kepler-90 resonances', KEYS.escape);
    await app.see('Kepler-90 resonances');
    expect(storedDay(replica, today)).toMatch(/<notebox id="[^"]+" label="label-lecture"><paragraph>Kepler-90 resonances<\/paragraph><\/notebox><paragraph><\/paragraph>$/);

    // e renames it, for every box with it.
    await app.press('e');
    await app.see('Rename “lecture”');
    await app.press(KEYS.enter, KEYS.ctrlU, 'Lectures', KEYS.enter);
    await app.see('Renamed it “Lectures”');
    expect(replica.queries.labels().find((l) => l.id === 'label-lecture').name).toBe('Lectures');

    // L picks a label by name.
    await app.press('L', 'meet');
    await app.see('label meet');
    await app.press(KEYS.enter);
    await app.see('● meeting');
    expect(app.frame()).toContain('Group meeting with the TESS team (weekly)');

    // Enter on a day opens it, by day.
    await app.press(KEYS.home, 'j');
    await vi.waitFor(() => expect(app.cursorLine('journal')).toContain('Today ·'));
    await app.press(KEYS.enter);
    await app.see('Discussed priors for the fits.');
    expect(app.frame()).toContain('TODAY');
  });

  it('goes from a box’s menu to its label’s notes, or to editing its label', async () => {
    const { replica, paths } = seededCopy();
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.cursorTo('journal', '● meeting');
    await app.press(KEYS.enter);
    await app.see('All “meeting” notes, by label');
    await app.press(KEYS.enter);
    await app.see('LABEL');
    expect(app.frame()).toContain('Group meeting with the TESS team');
    await app.press('v');
    await app.see('Discussed priors for the fits.');
    await app.cursorTo('journal', '● meeting');
    await app.press(KEYS.enter, KEYS.down, KEYS.down, KEYS.enter);
    await app.see('Change its color');
    await app.press(KEYS.down, KEYS.enter, 'teal', KEYS.enter);
    await vi.waitFor(() => expect(replica.queries.labels().find((l) => l.name === 'meeting').color).toBe('teal'));
  });

  it('writes in a pinned box where it shows, saved in its own day, and keeps the writing in the box', async () => {
    const { replica, paths, today } = seededCopy();
    replica.act('pinBox', today, 'box-meeting');
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press(']');
    await app.see('pinned from');
    await app.cursorTo('journal', 'Group meeting with the TESS team');
    await app.press('i', '!', KEYS.enter, KEYS.enter, 'still in it', KEYS.escape);
    expect(storedDay(replica, today)).toContain('<paragraph>Group meeting with the TESS team!</paragraph><paragraph></paragraph><paragraph>still in it</paragraph><taskref');
    expect(replica.queries.body(journalId(addDays(today, 1)))).toBeNull();
  });

  it('shows formulas as Unicode, and their LaTeX while the cursor is beside one', async () => {
    const { replica, paths } = seededCopy();
    const day = addDays(localDate(), -3);
    writeDay((...args) => replica.act(...args), day, (body, b) => {
      b.para(body, 'Agreed on ', { math: '\\sigma = 0.3' }, '.');
      b.element(body, 'blockMath', { latex: '\\chi^2 = \\sum_i x_i^2' });
      b.para(body, 'Kept: ', { math: '\\begin{pmatrix}a\\end{pmatrix}' });
    });
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press('g', 'three days ago', KEYS.enter);
    await app.see('Agreed on σ = 0.3.');
    expect(app.frame()).toContain('χ² = ∑ᵢ xᵢ²');
    expect(app.frame()).toContain('Kept: $\\begin{pmatrix}a\\end{pmatrix}$');
    await app.cursorTo('journal', 'Agreed on');
    await app.press('i', KEYS.left);
    await app.see('Agreed on $\\sigma = 0.3$.');
    await app.press(KEYS.escape);
    await app.see('Agreed on σ = 0.3.');
  });

  it('draws an image in place, and Enter saves it to open when there’s no display', async () => {
    const { replica, paths } = seededCopy();
    const day = addDays(localDate(), -2);
    const px = Buffer.alloc(40 * 20 * 3, 200);
    replica.act('addFile', 'file-plot', 'image/png', await sharp(px, { raw: { width: 40, height: 20, channels: 3 } }).png().toBuffer());
    writeDay((...args) => replica.act(...args), day, (body, b) => b.element(body, 'image', { file: 'file-plot', alt: 'light curve', width: 40, height: 20 }));
    const display = process.env.DISPLAY;
    delete process.env.DISPLAY;
    cleanups.push(() => display !== undefined && (process.env.DISPLAY = display));
    const app = renderApp(replica, paths);
    await app.see('Due today');
    await app.press('[', '[');
    await app.see('▀▀▀▀');
    // 40 × 20 pixels: 40 columns by 10 rows, captioned.
    expect(app.lines().filter((l) => l.includes('▀'.repeat(40)))).toHaveLength(10);
    expect(app.frame()).toContain('light curve');
    await app.cursorTo('journal', '▀▀▀▀');
    await app.press(KEYS.enter);
    if (process.platform === 'linux' && !process.env.WAYLAND_DISPLAY) {
      await app.see('No display to open it on here');
      expect(fs.existsSync(`${paths.images}/file-plot.png`)).toBe(true);
    }
  });
});
