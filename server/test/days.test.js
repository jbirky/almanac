import { describe, expect, it } from 'vitest';
import { LABEL_COLORS, MATCH_END, MATCH_START, addDays, journalId, labelId, localDate } from '@almanac/shared';
import { appendEquations, appendNoteBox, appendParagraph, bodyText, editBody, makeDevice, makeServer } from './helpers.js';

const today = localDate();
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);
const titles = (rows) => rows.map((t) => t.title);

function device() {
  const d = makeDevice(makeServer());
  d.make = (title, fields = {}) => d.actions.createItem({ type: 'task', title, ...fields });
  return d;
}

describe('open tasks', () => {
  it('lists open tasks soonest due first, with undated ones last', () => {
    const d = device();
    d.make('later', { due: addDays(today, 10) });
    d.make('undated');
    d.make('overdue', { due: addDays(today, -2) });
    d.make('today', { due: today });
    d.actions.setTaskStatus(d.make('finished', { due: today }), 'done');
    d.actions.deleteItem(d.make('deleted', { due: today }));

    expect(titles(d.queries.openTasks())).toEqual(['overdue', 'today', 'later', 'undated']);
  });
});

describe('categories', () => {
  it('labels a task with a category, lists the categories in use, and syncs them', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const abstract = laptop.actions.captureTask({ title: 'submit abstract', due: tomorrow, category: 'paper' });
    const dentist = laptop.actions.captureTask({ title: 'call dentist' });
    laptop.actions.setCategory(dentist, 'Errands');
    const gone = laptop.actions.captureTask({ title: 'deleted', category: 'Gone' });
    laptop.actions.deleteItem(gone);
    await laptop.sync();
    await phone.sync();

    expect(phone.queries.task(abstract)).toMatchObject({ title: 'submit abstract', due: tomorrow, category: 'paper' });
    expect(phone.queries.categories()).toEqual(['Errands', 'paper']);

    phone.actions.setCategory(abstract, null);
    await phone.sync();
    await laptop.sync();
    expect(laptop.queries.task(abstract).category).toBeNull();
    expect(laptop.queries.categories()).toEqual(['Errands']);
  });

  it('keeps tasks in the order they were moved into, after the ones never moved, and syncs it', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const listed = (d, category) => titles(d.queries.openTasks().filter((task) => (task.category ?? null) === category));
    const later = laptop.actions.captureTask({ title: 'later', due: addDays(today, 5), category: 'paper' });
    const soon = laptop.actions.captureTask({ title: 'soon', due: tomorrow, category: 'paper' });
    const undated = laptop.actions.captureTask({ title: 'undated', category: 'paper' });
    const errand = laptop.actions.captureTask({ title: 'errand', category: 'errands' });
    expect(listed(laptop, 'paper')).toEqual(['soon', 'later', 'undated']);

    // "undated" to the top: the first move numbers the whole category.
    laptop.actions.moveTask(undated, [{ id: undated, position: 1 }, { id: soon, position: 2 }, { id: later, position: 3 }]);
    expect(listed(laptop, 'paper')).toEqual(['undated', 'soon', 'later']);
    // A new task, never moved, comes first.
    laptop.actions.captureTask({ title: 'new', due: addDays(today, 9), category: 'paper' });
    expect(listed(laptop, 'paper')).toEqual(['new', 'undated', 'soon', 'later']);
    // Dropped among another category's tasks, a task takes that category.
    laptop.actions.moveTask(errand, [{ id: errand, position: 2.5 }], 'paper');
    expect(listed(laptop, 'paper')).toEqual(['new', 'undated', 'soon', 'errand', 'later']);
    expect(listed(laptop, 'errands')).toEqual([]);
    await laptop.sync();
    await phone.sync();
    expect(listed(phone, 'paper')).toEqual(['new', 'undated', 'soon', 'errand', 'later']);

    // Given another category with its chip, a task starts at the top of it.
    phone.actions.setCategory(soon, 'errands');
    phone.actions.setCategory(soon, 'paper');
    expect(listed(phone, 'paper')).toEqual(['soon', 'new', 'undated', 'errand', 'later']);
    // Setting the category it already has leaves it where it is.
    phone.actions.setCategory(errand, 'paper');
    expect(listed(phone, 'paper')).toEqual(['soon', 'new', 'undated', 'errand', 'later']);
  });

  it('keeps the order categories were moved into and syncs it, the latest order winning', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    expect(laptop.queries.categoryOrder()).toEqual([]);
    laptop.actions.setCategoryOrder(['paper', 'errands']);
    await laptop.sync();
    await phone.sync();
    expect(phone.queries.categoryOrder()).toEqual(['paper', 'errands']);

    laptop.tick(1000);
    phone.tick(2000);
    laptop.actions.setCategoryOrder(['errands', 'paper']);
    phone.actions.setCategoryOrder(['paper', 'observing', 'errands']);
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    expect(laptop.queries.categoryOrder()).toEqual(['paper', 'observing', 'errands']);
    expect(phone.queries.categoryOrder()).toEqual(['paper', 'observing', 'errands']);
  });
});

describe('notes boxes', () => {
  it('names a label after itself, so the same label made on two devices offline is one label', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const fromLaptop = laptop.actions.createLabel({ name: 'Paper notes' });
    const fromPhone = phone.actions.createLabel({ name: 'paper-notes' });
    expect(fromPhone).toBe(fromLaptop);
    expect(fromLaptop).toBe(labelId('PaperNotes'));
    expect(laptop.actions.createLabel({ name: 'Paper notes' })).toBe(fromLaptop);
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    expect(laptop.queries.labels()).toEqual(phone.queries.labels());
    expect(laptop.queries.labels()).toHaveLength(1);
  });

  it('gives each new label the color fewest labels have, and keeps a color picked by hand', () => {
    const d = device();
    for (let i = 0; i < LABEL_COLORS.length; i++) d.actions.createLabel({ name: `label ${i}` });
    expect(new Set(d.queries.labels().map((l) => l.color)).size).toBe(LABEL_COLORS.length);

    const meeting = d.actions.createLabel({ name: 'Meeting', color: 'pink' });
    d.actions.setLabelColor(meeting, 'teal');
    expect(d.queries.labels().find((l) => l.id === meeting).color).toBe('teal');
  });

  it('takes any "#rrggbb" color picked by hand, syncs it, and refuses anything else', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const meeting = laptop.actions.createLabel({ name: 'Meeting' });
    laptop.actions.setLabelColor(meeting, '#E0A800');
    for (const bad of ['chartreuse', '#fff', '#e0a80', 'url(x)', null]) {
      expect(() => laptop.actions.setLabelColor(meeting, bad)).toThrow();
    }
    await laptop.sync();
    await phone.sync();
    expect(phone.queries.labels().map((l) => l.color)).toEqual(['#e0a800']);
    // A color picked by hand doesn't use up a palette color.
    const lecture = phone.actions.createLabel({ name: 'Lecture' });
    expect(phone.queries.labels().find((l) => l.id === lecture).color).toBe(LABEL_COLORS[0]);
  });

  it("lists the days with a label's boxes, newest first, and syncs renames and deletes", async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const meeting = laptop.actions.createLabel({ name: 'Meeting' });
    const lecture = laptop.actions.createLabel({ name: 'Lecture notes' });
    for (const [date, labels] of [
      [yesterday, [meeting]],
      [today, [meeting, lecture]],
    ]) {
      const page = laptop.actions.ensureJournal(date);
      editBody(laptop, page, (f) => {
        appendParagraph(f, 'A quiet morning.');
        for (const label of labels) appendNoteBox(f, label, `${label === meeting ? 'Group meeting' : 'ASTR 507'} on ${date}`, 'priors look fine');
      });
      // The editor keeps a day's label links in step with its boxes.
      laptop.actions.syncBodyLinks(page, 'label', labels);
    }
    await laptop.sync();
    await phone.sync();

    expect(phone.queries.labelDays(meeting)).toEqual([today, yesterday]);
    expect(phone.queries.labels().map((l) => [l.name, l.days, l.last])).toEqual([
      ['Lecture notes', 1, today],
      ['Meeting', 2, today],
    ]);
    // Words in a box count for search like any other.
    expect(phone.queries.search('ASTR').map((r) => r.date)).toEqual([today]);

    phone.actions.updateItem(meeting, { title: 'Group meeting' });
    phone.actions.deleteItem(lecture);
    await phone.sync();
    await laptop.sync();
    expect(laptop.queries.labels().map((l) => l.name)).toEqual(['Group meeting']);

    // Bringing a deleted label back keeps its id, so its old boxes have it again.
    expect(laptop.actions.createLabel({ name: 'Lecture notes' })).toBe(lecture);
    expect(laptop.queries.labelDays(lecture)).toHaveLength(1);
  });

  it('shows a pinned box on the days after its own until it is unpinned, from the day it is unpinned on', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const day = (n) => addDays(today, n);
    const pinnedOn = (d, n) => d.queries.pinnedBoxes(day(n)).map((p) => `${p.date === today ? 'today' : p.date}:${p.box}`);
    laptop.actions.ensureJournal(today);
    laptop.actions.pinBox(today, 'box-1');
    expect(pinnedOn(laptop, 0)).toEqual([]);
    expect(pinnedOn(laptop, -1)).toEqual([]);
    expect(pinnedOn(laptop, 1)).toEqual(['today:box-1']);
    expect(pinnedOn(laptop, 30)).toEqual(['today:box-1']);
    expect(laptop.queries.pinnedFrom(today)).toEqual(['box-1']);
    await laptop.sync();
    await phone.sync();
    expect(pinnedOn(phone, 5)).toEqual(['today:box-1']);

    // Unpinned while looking at a later day: gone from it on, still there before it.
    phone.actions.unpinBox(today, 'box-1', day(5));
    expect(pinnedOn(phone, 4)).toEqual(['today:box-1']);
    expect(pinnedOn(phone, 5)).toEqual([]);
    expect(pinnedOn(phone, 9)).toEqual([]);
    expect(phone.queries.pinnedFrom(today)).toEqual([]);
    // Pinned again: on every later day again.
    phone.actions.pinBox(today, 'box-1');
    expect(pinnedOn(phone, 9)).toEqual(['today:box-1']);
    // Unpinned from its own day: on none.
    phone.actions.unpinBox(today, 'box-1', today);
    expect(pinnedOn(phone, 1)).toEqual([]);
    await phone.sync();
    await laptop.sync();
    expect(pinnedOn(laptop, 1)).toEqual([]);
  });

  it("files a task written in a box under the box's label, or a category of that name in any case", async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const page = laptop.actions.ensureJournal(today);
    const meeting = laptop.actions.createLabel({ name: 'Meeting' });
    const reading = laptop.actions.createLabel({ name: 'Paper reading' });
    laptop.actions.captureTask({ title: 'book the room', category: 'meeting' });
    const priors = laptop.actions.createTaskInNote(page, 'Email the priors', undefined, {}, meeting);
    const smith = laptop.actions.createTaskInNote(page, 'Read Smith et al.', undefined, {}, reading);
    const loose = laptop.actions.createTaskInNote(page, 'Outside any box');
    laptop.actions.deleteItem(reading);
    const orphan = laptop.actions.createTaskInNote(page, 'In a box whose label was deleted', undefined, {}, reading);
    await laptop.sync();
    await phone.sync();

    expect(phone.queries.task(priors).category).toBe('meeting');
    expect(phone.queries.task(smith).category).toBe('Paper reading');
    expect(phone.queries.task(loose).category).toBeNull();
    expect(phone.queries.task(orphan).category).toBeNull();
    expect(phone.queries.categories()).toEqual(['meeting', 'Paper reading']);
  });
});

describe('subtasks', () => {
  it('lists subtasks under their task, not on their own, with counts, and syncs them', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const parent = laptop.actions.captureTask({ title: 'submit abstract', due: today });
    const draft = laptop.actions.addSubtask(parent, 'draft');
    // Subtasks list oldest first. A test device's clock stands still until it ticks.
    laptop.tick(1000);
    laptop.actions.addSubtask(parent, 'figures');
    laptop.actions.setTaskStatus(draft, 'done');
    await laptop.sync();
    await phone.sync();

    expect(titles(phone.queries.openTasks())).toEqual(['submit abstract']);
    expect(titles(phone.queries.subtasks(parent))).toEqual(['draft', 'figures']);
    const row = phone.queries.task(parent);
    expect([row.subtasks, row.subtasks_done]).toEqual([2, 1]);
    // A finished subtask doesn't count as a finished task of its own.
    expect(phone.queries.dayTasks(today, today)).toMatchObject({ finished: [] });
    expect(titles(phone.queries.dayTasks(today, today).due)).toEqual(['submit abstract']);
    expect(phone.queries.heatmap(today, tomorrow, today)[today]?.done ?? 0).toBe(0);
  });

  it("deletes a task's subtasks with it", () => {
    const d = device();
    const parent = d.make('parent');
    const child = d.actions.addSubtask(parent, 'child');
    d.actions.deleteTask(parent);
    expect(d.queries.task(child).deleted).toBe(1);
    expect(d.queries.openTasks()).toEqual([]);
  });

  it('lets a subtask stand on its own when only its task was deleted, as an older version does', () => {
    const d = device();
    const parent = d.make('parent');
    d.actions.addSubtask(parent, 'child');
    d.actions.deleteItem(parent);
    expect(titles(d.queries.openTasks())).toEqual(['child']);
  });
});

describe('day pages', () => {
  it("lists what's due that day, what's overdue on today's, and what else was finished that day", () => {
    const d = device();
    const panel = (date) => {
      const { due, overdue, finished } = d.queries.dayTasks(date, today);
      // Sorted where two tasks can be finished in the same millisecond.
      return { due: titles(due), overdue: titles(overdue), finished: titles(finished).sort() };
    };
    d.make('overdue', { due: yesterday });
    d.make('due today', { due: today });
    d.make('due tomorrow', { due: tomorrow });
    d.actions.setTaskStatus(d.make('finished early', { due: tomorrow }), 'done');
    d.actions.setTaskStatus(d.make('undated, finished'), 'done');

    expect(panel(today)).toEqual({ due: ['due today'], overdue: ['overdue'], finished: ['finished early', 'undated, finished'] });
    // Finished tasks stay with the day they were due, after the open ones.
    expect(panel(tomorrow)).toEqual({ due: ['due tomorrow', 'finished early'], overdue: [], finished: [] });
    expect(panel(yesterday)).toEqual({ due: ['overdue'], overdue: [], finished: [] });
  });

  it("lists journal tasks due that day, but not again among the finished, since the journal shows them", () => {
    const d = device();
    const page = d.actions.ensureJournal(today);
    d.actions.createTaskInNote(page, 'written in the journal', undefined, { due: today });
    d.make('added elsewhere', { due: today });
    expect(titles(d.queries.dayTasks(today, today).due).sort()).toEqual(['added elsewhere', 'written in the journal']);

    d.actions.setTaskStatus(d.actions.createTaskInNote(page, 'undated in the journal'), 'done');
    d.actions.setTaskStatus(d.make('undated elsewhere'), 'done');
    expect(titles(d.queries.dayTasks(today, today).finished)).toEqual(['undated elsewhere']);
  });

  it('reads equations as their LaTeX, for search and the word count', () => {
    const d = device();
    const page = d.actions.ensureJournal(today);
    editBody(d, page, (f) => appendEquations(f, 'Energy is ', 'E = mc^2', ' here.', '\\int_0^1 x\\,dx'));
    expect(bodyText(d, page)).toBe('Energy is E = mc^2 here.\n\\int_0^1 x\\,dx');
    expect(d.queries.search('mc').map((r) => r.date)).toEqual([today]);
  });

  it('gives the same day the same journal on every device, so offline entries merge', async () => {
    const server = makeServer();
    const laptop = makeDevice(server);
    const phone = makeDevice(server);
    const id = laptop.actions.ensureJournal(today);
    expect(phone.actions.ensureJournal(today)).toBe(id);
    expect(id).toBe(journalId(today));

    editBody(laptop, id, (f) => appendParagraph(f, 'laptop thought'));
    editBody(phone, id, (f) => appendParagraph(f, 'phone thought'));
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    expect(bodyText(laptop, id)).toBe(bodyText(phone, id));
    expect(bodyText(laptop, id)).toContain('laptop thought');
    expect(bodyText(laptop, id)).toContain('phone thought');
  });
});

describe('calendar', () => {
  it('counts tasks finished, words written and open tasks due, per day', () => {
    const d = device();
    d.actions.setTaskStatus(d.make('a'), 'done');
    d.actions.setTaskStatus(d.make('b'), 'done');
    const gone = d.make('deleted after finishing');
    d.actions.setTaskStatus(gone, 'done');
    d.actions.deleteItem(gone);
    d.make('due tomorrow', { due: tomorrow });
    d.make('also due tomorrow', { due: tomorrow });
    d.actions.setTaskStatus(d.make('finished, due tomorrow', { due: tomorrow }), 'done');
    editBody(d, d.actions.ensureJournal(yesterday), (f) => appendParagraph(f, 'three short words'));

    const days = d.queries.heatmap(addDays(today, -7), addDays(today, 7), today);
    expect(days[today]).toEqual({ done: 3, words: 0, due: 0 });
    expect(days[yesterday]).toEqual({ done: 0, words: 3, due: 0 });
    expect(days[tomorrow]).toEqual({ done: 0, words: 0, due: 2 });
  });
});

describe('search', () => {
  it('finds days by what was written on them and by their tasks', () => {
    const d = device();
    editBody(d, d.actions.ensureJournal(yesterday), (f) => appendParagraph(f, 'Discussed priors for the fits'));
    d.actions.createTaskInNote(d.actions.ensureJournal(today), 'Book telescope time', undefined, { due: addDays(today, 3) });
    d.make('Order a telescope filter', { due: addDays(today, 5) });

    const [hit] = d.queries.search('priors');
    expect(hit.date).toBe(yesterday);
    expect(hit.snippet).toContain(`${MATCH_START}priors${MATCH_END}`);
    // A task counts for the journal day it was written on, else the day it's due.
    expect(d.queries.search('telescope').map((r) => r.date)).toEqual([addDays(today, 5), today]);
    expect(d.queries.search('   ')).toEqual([]);
  });
});

describe('one date per task', () => {
  it('moves a scheduled date into due, keeping an existing due date', () => {
    const d = device();
    const scheduled = d.make('scheduled only', { scheduled: tomorrow });
    const both = d.make('both', { scheduled: tomorrow, due: addDays(today, 5) });
    d.make('neither');

    expect(d.actions.foldScheduledIntoDue()).toBe(2);
    expect(d.queries.task(scheduled).due).toBe(tomorrow);
    expect(d.queries.task(both).due).toBe(addDays(today, 5));
    expect(d.db.get('SELECT COUNT(*) AS n FROM items WHERE scheduled IS NOT NULL').n).toBe(0);
    expect(d.actions.foldScheduledIntoDue()).toBe(0);
  });

  it('folds a task from a device on the old version, and the result syncs back to it', async () => {
    const server = makeServer();
    const old = makeDevice(server);
    const upgraded = makeDevice(server);
    const id = old.actions.createItem({ type: 'task', title: 'call dentist', scheduled: tomorrow });
    await old.sync();
    await upgraded.sync();

    upgraded.actions.foldScheduledIntoDue();
    await upgraded.sync();
    await old.sync();

    expect(old.db.get('SELECT due, scheduled FROM items WHERE id = ?', [id])).toEqual({ due: tomorrow, scheduled: null });
  });
});
