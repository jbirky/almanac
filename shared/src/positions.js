// Where a task goes in the list on the left. A task moved there has a position: a number that
// orders it among its category's tasks (props, key 'position'). Tasks never moved have none and
// come first, soonest due first, so a new task shows at the top of its category.

// The positions to write so task `id` lands at `index` among `others`: the other tasks of the
// category it goes to, in the order shown, each { id, position } (null if it has none). Usually
// only the moved task's, between its new neighbours'; every task's, numbered in the order shown,
// when some have none yet or there's no room left between two numbers.
export function taskPositions(id, others, index) {
  const before = others[index - 1]?.position;
  const after = others[index]?.position;
  if (others.every((t) => typeof t.position === 'number')) {
    let position;
    if (before === undefined && after === undefined) position = 1;
    else if (before === undefined) position = after - 1;
    else if (after === undefined) position = before + 1;
    else position = (before + after) / 2;
    const fits = (before === undefined || position > before) && (after === undefined || position < after);
    if (fits) return [{ id, position }];
  }
  const ids = others.map((t) => t.id);
  ids.splice(index, 0, id);
  return ids.map((taskId, i) => ({ id: taskId, position: i + 1 }));
}
