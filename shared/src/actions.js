import { CATEGORY_ORDER } from './categories.js';
import { LABEL_COLORS, isLabelColor, labelId } from './labels.js';
import { journalId, newId, toBase64 } from './util.js';

const TASK_EVENT = { open: 'reopened', done: 'done', dropped: 'dropped' };

// Domain-level writes, each turned into one atomic batch of cell changes.
export function createActions(core, { now = () => new Date().toISOString() } = {}) {
  const cells = (tbl, row, fields) =>
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([col, value]) => ({ tbl, row, col, value }));

  const taskEvent = (itemId, event, at) =>
    cells('task_events', newId(), { item_id: itemId, event, at });

  const leastUsedColor = () => {
    const uses = new Map(LABEL_COLORS.map((c) => [c, 0]));
    for (const { color } of core.db.all(
      `SELECT json_extract(p.value, '$') AS color FROM props p JOIN items i ON i.id = p.item_id
       WHERE p.key = 'color' AND p.deleted = 0 AND json_valid(p.value) AND i.type = 'label' AND i.deleted = 0`,
    )) {
      if (uses.has(color)) uses.set(color, uses.get(color) + 1);
    }
    return LABEL_COLORS.reduce((best, c) => (uses.get(c) < uses.get(best) ? c : best));
  };

  // The category a task written in a notes box starts with: its label's name, or a category of
  // that name already in use, whatever its case. Null for a box without a (live) label.
  const labelCategory = (labelId) => {
    const name = labelId
      ? core.db.get(`SELECT title FROM items WHERE id = ? AND type = 'label' AND deleted = 0`, [labelId])?.title?.trim()
      : null;
    if (!name) return null;
    const inUse = core.db.all(
      `SELECT DISTINCT json_extract(p.value, '$') AS name FROM props p JOIN items i ON i.id = p.item_id
       WHERE p.key = 'category' AND p.deleted = 0 AND json_valid(p.value) AND i.type = 'task' AND i.deleted = 0`,
    );
    return inUse.map((r) => r.name).find((c) => typeof c === 'string' && c.toLowerCase() === name.toLowerCase()) ?? name;
  };

  const actions = {
    // `id` may be supplied by the caller (the editor names a task before it exists).
    createItem({ id = newId(), type = 'note', title = '', ...fields } = {}) {
      const at = now();
      const changes = cells('items', id, { type, title, created_at: at, ...fields });
      if (type === 'task') {
        if (!fields.status) changes.push(...cells('items', id, { status: 'open' }));
        changes.push(...taskEvent(id, 'created', at));
      }
      core.mutate(changes);
      return id;
    },

    updateItem(id, fields) {
      core.mutate(cells('items', id, fields));
    },

    setTaskStatus(id, status) {
      const at = now();
      core.mutate([
        ...cells('items', id, { status, done_at: status === 'open' ? null : at }),
        ...taskEvent(id, TASK_EVENT[status], at),
      ]);
    },

    deleteItem(id) {
      core.mutate(cells('items', id, { deleted: 1 }));
    },

    // A subtask is a task linked from its parent ('subtask'), and listed under it.
    addSubtask(parentId, title = '', id = newId()) {
      return core.write(() => {
        actions.createItem({ id, type: 'task', title });
        actions.addLink(parentId, id, 'subtask');
        return id;
      });
    },

    // Deletes a task and its live subtasks, and returns their ids, the task's first.
    deleteTask(id) {
      return core.write(() => {
        const subtasks = core.db
          .all(
            `SELECT l.to_id FROM links l JOIN items s ON s.id = l.to_id
             WHERE l.from_id = ? AND l.kind = 'subtask' AND l.deleted = 0 AND s.deleted = 0`,
            [id],
          )
          .map((l) => l.to_id);
        for (const subtask of subtasks) actions.deleteItem(subtask);
        actions.deleteItem(id);
        return [id, ...subtasks];
      });
    },

    // Brings deleted items back, such as a task and the subtasks deleted with it, in one batch.
    restoreItems(ids) {
      core.mutate(ids.flatMap((id) => cells('items', id, { deleted: 0 })));
    },

    // A task's category is a prop holding its name; null removes it. A task given another
    // category loses its place in the list (a position orders it among one category's tasks),
    // so it starts at the top of the new one.
    setCategory(id, name) {
      const row = `${id}/category`;
      const current =
        core.db.get(`SELECT json_extract(value, '$') AS name FROM props WHERE id = ? AND deleted = 0 AND json_valid(value)`, [row])
          ?.name ?? null;
      core.write(() => {
        core.mutate(
          name
            ? cells('props', row, { item_id: id, key: 'category', value: JSON.stringify(name), deleted: 0 })
            : cells('props', row, { deleted: 1 }),
        );
        const placed = core.db.get(`SELECT 1 AS x FROM props WHERE id = ? AND deleted = 0`, [`${id}/position`]);
        if (placed && (name ?? null) !== current) core.mutate(cells('props', `${id}/position`, { deleted: 1 }));
      });
    },

    // Moves a task in the list on the left: the positions from taskPositions (its own, and the
    // other tasks' when they need one), and its category when it was dropped among another
    // category's tasks (null for none), all in one batch.
    moveTask(id, positions, category) {
      core.write(() => {
        if (category !== undefined) actions.setCategory(id, category);
        core.mutate(
          positions.flatMap((p) =>
            cells('props', `${p.id}/position`, { item_id: p.id, key: 'position', value: JSON.stringify(p.position), deleted: 0 }),
          ),
        );
      });
    },

    // The task list's order of categories, as a list of names (see orderCategories). One cell,
    // so the latest order set on any device wins.
    setCategoryOrder(names) {
      core.mutate(
        cells('props', CATEGORY_ORDER, { item_id: 'settings', key: 'categoryOrder', value: JSON.stringify(names), deleted: 0 }),
      );
    },

    // A task from the task box, already parsed, with its category in the same batch.
    captureTask({ title, due = null, category = null }) {
      return core.write(() => {
        const id = actions.createItem({ type: 'task', title, due });
        if (category) actions.setCategory(id, category);
        return id;
      });
    },

    // A label for notes boxes. Its id normally comes from its name (labelId), so creating one
    // that exists does nothing, and creating a deleted one brings it back with its old color.
    // A new label takes the color fewest labels have.
    createLabel({ name, id = labelId(name), color }) {
      return core.write(() => {
        const row = core.db.get('SELECT deleted FROM items WHERE id = ?', [id]);
        if (!row) {
          actions.createItem({ id, type: 'label', title: name });
          actions.setLabelColor(id, color ?? leastUsedColor());
        } else if (row.deleted) {
          actions.updateItem(id, { title: name, deleted: 0 });
          if (color) actions.setLabelColor(id, color);
        }
        return id;
      });
    },

    // Pins a notes box (`boxId`, in the journal of `date`) to the days after it: each of them
    // shows it, the same box, until it's unpinned.
    pinBox(date, boxId) {
      const id = journalId(date);
      core.mutate(
        cells('props', `${id}/pin/${boxId}`, { item_id: id, key: 'pin', value: JSON.stringify({ box: boxId, until: null }), deleted: 0 }),
      );
    },

    // Unpins a box from day `from` on: that day and the ones after it no longer show it, the
    // days before still do. From the box's own day, that's every day.
    unpinBox(date, boxId, from) {
      const row = `${journalId(date)}/pin/${boxId}`;
      core.mutate(
        from <= date
          ? cells('props', row, { deleted: 1 })
          : cells('props', row, { value: JSON.stringify({ box: boxId, until: from }) }),
      );
    },

    // One of LABEL_COLORS, or "#rrggbb" for a color picked by hand.
    setLabelColor(id, color) {
      color = typeof color === 'string' ? color.toLowerCase() : color;
      if (!isLabelColor(color)) throw new Error(`Not a label color: ${color}`);
      core.mutate(cells('props', `${id}/color`, { item_id: id, key: 'color', value: JSON.stringify(color), deleted: 0 }));
    },

    addLink(fromId, toId, kind) {
      const id = `${fromId}>${kind}>${toId}`;
      core.mutate(cells('links', id, { from_id: fromId, to_id: toId, kind, deleted: 0 }));
      return id;
    },

    removeLink(fromId, toId, kind) {
      core.mutate(cells('links', `${fromId}>${kind}>${toId}`, { deleted: 1 }));
    },

    // A task created from inside a note: the task plus the note's embed link, in one batch. One
    // written in a notes box (`labelId` is the box's label) is filed under the label's name.
    createTaskInNote(noteId, title = '', id = newId(), fields = {}, labelId = null) {
      return core.write(() => {
        actions.createItem({ id, type: 'task', title, ...fields });
        actions.addLink(noteId, id, 'embed');
        const category = labelCategory(labelId);
        if (category) actions.setCategory(id, category);
        return id;
      });
    },

    // Make a note's links of one kind match what its body contains: 'embed' links to its task
    // blocks, 'label' links to the labels on its notes boxes. A block that is deleted, undone
    // or pasted elsewhere never leaves a stale link.
    syncBodyLinks(noteId, kind, ids) {
      const want = new Set(ids);
      const have = new Set(
        core.db
          .all('SELECT to_id FROM links WHERE from_id = ? AND kind = ? AND deleted = 0', [noteId, kind])
          .map((l) => l.to_id),
      );
      core.write(() => {
        for (const id of want) if (!have.has(id)) actions.addLink(noteId, id, kind);
        for (const id of have) if (!want.has(id)) actions.removeLink(noteId, id, kind);
      });
    },

    // Creates the journal item for a day the first time it is written in; safe to repeat.
    ensureJournal(date) {
      const id = journalId(date);
      if (!core.db.get('SELECT 1 AS x FROM items WHERE id = ?', [id])) {
        actions.createItem({ id, type: 'journal', title: date });
      }
      return id;
    },

    // An image for a note, as its bytes. Files never change, so one already here isn't sent again.
    addFile(id, type, bytes) {
      if (core.db.get('SELECT 1 AS x FROM files WHERE id = ? AND data IS NOT NULL', [id])) return;
      core.mutate(cells('files', id, { type, data: toBase64(bytes) }));
    },

    applyBodyUpdate(itemId, update) {
      core.mutate([{ tbl: 'bodies', row: itemId, col: 'ydoc', value: toBase64(update) }]);
    },

    // Tasks used to have a scheduled date as well as a due date; now they have one. Moves a
    // scheduled date into `due` (an existing due date wins) and clears it. Safe to repeat, so
    // it runs after every sync and catches tasks written by a device on the old version.
    foldScheduledIntoDue() {
      const rows = core.db.all(
        `SELECT id, due, scheduled FROM items WHERE type = 'task' AND deleted = 0 AND scheduled IS NOT NULL`,
      );
      if (rows.length) {
        core.write(() => {
          for (const r of rows) actions.updateItem(r.id, { due: r.due ?? r.scheduled, scheduled: null });
        });
      }
      return rows.length;
    },
  };
  return actions;
}
