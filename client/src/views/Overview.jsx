import { useEffect, useMemo, useRef, useState } from 'react';
import { MATCH_END, MATCH_START, moveCategory, orderCategories, shortDay, taskPositions, timeOfDay } from '@almanac/shared';
import { Heatmap } from '../components/Heatmap.jsx';
import { GripIcon } from '../components/icons.jsx';
import { TaskInput, TaskRow } from '../components/TaskRow.jsx';
import { colorProps } from '../lib/color.js';
import { action, syncNow } from '../lib/db.js';
import { useQuery, useSyncStatus } from '../lib/hooks.js';
import { dragToReorder } from '../lib/reorder.js';

// The left panel: the calendar, search, and every open task by category. While the journal
// shows a label, the calendar shows that label's days in its color.
export function Overview({ day, today, label, onSelect, onClose, addRef, searchRef }) {
  const [q, setQ] = useState('');
  const searching = q.trim() !== '';
  const results = useQuery('search', [q.trim()], ['items', 'bodies', 'links']);
  const labelDays = useQuery('labelDays', [label?.id ?? null]);
  const matches = useMemo(() => {
    const dates = searching ? results?.map((r) => r.date) : label && labelDays;
    return dates ? new Set(dates) : null;
  }, [searching, results, label, labelDays]);

  return (
    <aside className="overview" aria-label="Calendar and tasks" {...colorProps(searching ? null : label?.color)}>
      <div className="overview-top">
        <input
          ref={searchRef}
          type="search"
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          placeholder="Search"
          aria-label="Search"
        />
        <button className="close-overview" onClick={onClose} aria-label="Close calendar">
          ×
        </button>
      </div>
      <Heatmap day={day} today={today} onSelect={onSelect} matches={matches} />
      {searching ? (
        <SearchResults results={results} today={today} onSelect={onSelect} />
      ) : (
        <>
          <TaskInput inputRef={addRef} today={today} />
          <TaskList today={today} />
        </>
      )}
      <SyncStatus />
    </aside>
  );
}

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The lines between elements of a list where something dragged can go, for dragToReorder: one
// above each element, and one below the last. Each is { group, index, y }.
const placesAmong = (elements, group) =>
  elements.flatMap((el, index) => {
    const box = el.getBoundingClientRect();
    const above = { group, index, y: box.top };
    return index === elements.length - 1 ? [above, { group, index: index + 1, y: box.bottom }] : [above];
  });

// One place up (-1) or down (1) for ↑ and ↓ on a grip.
const arrowStep = (e) => ({ ArrowUp: -1, ArrowDown: 1 })[e.key];

// Open tasks by category. Categories go in the order you set (the same on every device), then
// ones never moved, alphabetically, with uncategorized tasks last. Within each, tasks never moved
// come first, soonest due first, then the ones moved, in the order you set. Categories and tasks
// move by the grip beside them: drag it, or focus it and press ↑ or ↓. A task dragged among
// another category's tasks takes that category. The "No category" heading only shows when there
// are categories to set it apart.
function TaskList({ today }) {
  const tasks = useQuery('openTasks');
  const saved = useQuery('categoryOrder');
  // A new order of categories, shown until the saved one catches up with it.
  const [pending, setPending] = useState(null);
  // While something is dragged: what ({ category } or { task }), and where it would go
  // ({ group, index }: a category's name, '' for none, and the place among its other tasks).
  const [drag, setDrag] = useState(null);
  // Something moved with the keyboard, whose grip keeps the focus once it shows in its place.
  const refocus = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (pending && saved && sameList(saved, pending)) setPending(null);
  }, [saved, pending]);

  const order = pending ?? saved;
  const byCategory = new Map();
  for (const t of tasks ?? []) {
    const key = t.category ?? '';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(t);
  }
  const named = orderCategories([...byCategory.keys()].filter(Boolean), order ?? []);

  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    const there = want.task ? byCategory.get(want.group)?.[want.index]?.id === want.task : named[want.index] === want.category;
    if (!there) return;
    refocus.current = null;
    const grip = listRef.current?.querySelector(
      want.task
        ? `[data-task="${CSS.escape(want.task)}"] .list-grip`
        : `[data-category="${CSS.escape(want.category)}"] > .task-group-head .list-grip`,
    );
    if (grip && document.activeElement !== grip) grip.focus();
  });

  if (!tasks || !order) return null;
  if (!tasks.length) return <p className="empty">No open tasks.</p>;
  const names = byCategory.has('') ? [...named, ''] : named;
  const scroller = () => listRef.current.closest('.overview');

  const moveCategoryTo = (name, index) => {
    const next = moveCategory(named, order, name, index);
    setPending(next);
    action.setCategoryOrder(next);
  };

  // Puts a task at `index` among the other tasks of category `group` ('' for none), giving it
  // that category if it had another.
  const moveTaskTo = (task, group, index) => {
    const others = byCategory.get(group).filter((t) => t.id !== task.id);
    const category = group === (task.category ?? '') ? undefined : group || null;
    action.moveTask(task.id, taskPositions(task.id, others, index), category);
  };

  const dragCategory = (e, name) => {
    const from = named.indexOf(name);
    const others = [...listRef.current.querySelectorAll('.task-group[data-category]')].filter((s) => s.dataset.category !== name);
    dragToReorder(e, {
      scroller: scroller(),
      places: placesAmong(others, null),
      onPlace: (place) => setDrag(place && { category: name, ...place }),
      onDrop: ({ index }) => index !== from && moveCategoryTo(name, index),
    });
  };

  const dragTask = (e, task) => {
    const own = task.category ?? '';
    const from = byCategory.get(own).indexOf(task);
    const places = names.flatMap((group) => {
      const section = listRef.current.querySelector(`.task-group[data-group="${CSS.escape(group)}"]`);
      const items = [...section.querySelectorAll(':scope > .task-list > .task-item')].filter((li) => li.dataset.task !== task.id);
      // A category with only this task in it: its own place.
      if (!items.length) return [{ group, index: 0, y: section.querySelector('.task-list').getBoundingClientRect().top }];
      return placesAmong(items, group);
    });
    dragToReorder(e, {
      scroller: scroller(),
      places,
      onPlace: (place) => setDrag(place && { task: task.id, ...place }),
      onDrop: ({ group, index }) => (group !== own || index !== from) && moveTaskTo(task, group, index),
    });
  };

  const categoryKey = (e, name) => {
    const step = arrowStep(e);
    if (!step) return;
    e.preventDefault();
    const index = named.indexOf(name) + step;
    if (index < 0 || index >= named.length) return;
    refocus.current = { category: name, index };
    moveCategoryTo(name, index);
  };

  // By keyboard, a task moves within its category; its chip changes the category.
  const taskKey = (e, task) => {
    const step = arrowStep(e);
    if (!step) return;
    e.preventDefault();
    const group = task.category ?? '';
    const list = byCategory.get(group);
    const index = list.indexOf(task) + step;
    if (index < 0 || index >= list.length) return;
    refocus.current = { task: task.id, group, index };
    moveTaskTo(task, group, index);
  };

  // Where a dragged category or task would go: a line above the one it would go before, or
  // below the last. Nothing while it would stay where it is.
  const dropClass = (others, at, item, from) => {
    if (at === from) return '';
    if (others[at] === item) return ' drop-before';
    return at === others.length && others.at(-1) === item ? ' drop-after' : '';
  };
  const categoryClass = (name) => {
    if (!drag?.category) return '';
    if (drag.category === name) return ' dragging';
    const others = named.filter((n) => n !== drag.category);
    return dropClass(others, drag.index, name, named.indexOf(drag.category));
  };
  const taskClass = (task) => {
    if (!drag?.task) return '';
    if (drag.task === task.id) return ' dragging';
    const group = task.category ?? '';
    if (drag.group !== group) return '';
    const list = byCategory.get(group);
    const others = list.filter((t) => t.id !== drag.task);
    const own = list.findIndex((t) => t.id === drag.task);
    return dropClass(others, drag.index, task, own === -1 ? null : own);
  };

  return (
    <div className="task-groups" ref={listRef}>
      {names.map((name) => (
        <section
          key={name}
          className={`task-group${name ? '' : ' uncategorized'}${categoryClass(name)}`}
          data-category={name || undefined}
          data-group={name}
          aria-label={name || 'No category'}
        >
          {(name || names.length > 1) && (
            <div className="task-group-head">
              {name && named.length > 1 && (
                <Grip label={`Move ${name}`} onPointerDown={(e) => dragCategory(e, name)} onKeyDown={(e) => categoryKey(e, name)} />
              )}
              <h2>{name || 'No category'}</h2>
            </div>
          )}
          <ul className="task-list">
            {byCategory.get(name).map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                day={null}
                quietCategory
                className={taskClass(t)}
                grip={<Grip label={`Move “${t.title || 'Untitled task'}”`} onPointerDown={(e) => dragTask(e, t)} onKeyDown={(e) => taskKey(e, t)} />}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// What a category or task in the list is moved by, in the margin beside it.
function Grip({ label, onPointerDown, onKeyDown }) {
  return (
    <button
      type="button"
      className="list-grip"
      aria-label={label}
      title="Drag to move, or press ↑ or ↓"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <GripIcon />
    </button>
  );
}

function Snippet({ text }) {
  const parts = text.split(new RegExp(`(${MATCH_START}[^${MATCH_END}]*${MATCH_END})`));
  return parts.map((part, i) =>
    part.startsWith(MATCH_START) ? <mark key={i}>{part.slice(1, -1)}</mark> : <span key={i}>{part}</span>,
  );
}

// The days that match a search, each with a line from it.
function SearchResults({ results, today, onSelect }) {
  if (!results) return null;
  if (!results.length) return <p className="empty">No matching days.</p>;
  return (
    <ul className="search-results" aria-label="Matching days">
      {results.map((r) => (
        <li key={r.date}>
          <button onClick={() => onSelect(r.date)}>
            <span className="result-day">{shortDay(r.date, today)}</span>
            {r.snippet && (
              <span className="subtle">
                <Snippet text={r.snippet} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

// A quiet dot while all is well; words only when something needs attention.
function SyncStatus() {
  const status = useSyncStatus();
  let state = 'starting';
  let text = 'Starting…';
  if (status?.error) [state, text] = ['error', `Sync error: ${status.error}`];
  else if (status && !status.online) [state, text] = ['offline', status.pending ? `Offline · ${status.pending} changes waiting` : 'Offline'];
  else if (status?.pending) [state, text] = ['syncing', 'Syncing…'];
  else if (status?.lastSync) [state, text] = ['synced', `Synced ${timeOfDay(status.lastSync)}`];
  else if (status) text = 'Not synced yet';
  const loud = state === 'error' || state === 'offline';
  return (
    <div className="sync-status" data-state={state}>
      <button onClick={() => syncNow()} title={`${text}. Click to sync now.`}>
        <span className="sync-dot" aria-hidden="true" />
        <span className={loud ? '' : 'visually-hidden'}>{text}</span>
      </button>
      {status?.storage === 'memory' && (
        <span className="warn">Not saved on this device (storage unavailable, or open in another tab)</span>
      )}
    </div>
  );
}
