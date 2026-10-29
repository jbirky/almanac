import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { action } from '../lib/db.js';
import { useDebounced, useQuery } from '../lib/hooks.js';
import { SubtasksIcon, TrashIcon } from './icons.jsx';

// Which tasks have their subtasks showing. This browser's own: kept in its storage, not synced,
// and shared by every place the task shows, so opening it in the journal opens it in the list.
const OPEN_KEY = 'almanac.openSubtasks';
const listeners = new Set();
let open = new Set();
try {
  open = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'));
} catch {
  // Storage unavailable or unreadable: everything starts closed.
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function setOpen(id, value) {
  open = new Set(open);
  if (value) open.add(id);
  else open.delete(id);
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Storage unavailable: it stays open until the page reloads.
  }
  for (const listener of listeners) listener();
}

export function useSubtasksOpen(id) {
  return useSyncExternalStore(subscribe, () => open.has(id));
}

// Tasks whose box for a new subtask takes focus when it shows.
const focusAdd = new Set();

// A task's subtasks as a chip: "2/5" done, which shows or hides them, or "Add subtask" (on
// hover, like the other empty chips) when it has none.
export function SubtaskChip({ task, isOpen }) {
  const count = task.subtasks ?? 0;
  const toggle = () => {
    if (!isOpen && !count) focusAdd.add(task.id);
    setOpen(task.id, !isOpen);
  };
  return (
    <button
      className={`subtask-chip${count ? '' : ' empty'}`}
      onClick={toggle}
      aria-expanded={isOpen}
      aria-label={count ? `Subtasks, ${task.subtasks_done} of ${count} done` : 'Add a subtask'}
      title={count ? `${isOpen ? 'Hide' : 'Show'} subtasks` : 'Add a subtask'}
    >
      {count ? `${task.subtasks_done}/${count}` : <SubtasksIcon />}
    </button>
  );
}

// A task's subtasks, each checked off, renamed or deleted in place, and a box to add more.
export function SubtaskList({ parentId }) {
  const subtasks = useQuery('subtasks', [parentId]);
  const addRef = useRef(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (focusAdd.delete(parentId)) addRef.current?.focus();
  }, [parentId]);

  const add = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    action.addSubtask(parentId, text.trim());
    setText('');
  };

  return (
    <div className="subtasks">
      {subtasks?.length > 0 && (
        <ul className="subtask-list" aria-label="Subtasks">
          {subtasks.map((t) => (
            <SubtaskRow key={t.id} task={t} onDone={() => addRef.current?.focus()} />
          ))}
        </ul>
      )}
      <form className="subtask-add" onSubmit={add}>
        <input
          ref={addRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
          placeholder="Add a subtask"
          aria-label="New subtask"
        />
      </form>
    </div>
  );
}

// One subtask. Enter goes on to the box for the next; Backspace in an empty one deletes it.
function SubtaskRow({ task, onDone }) {
  const [draft, setDraft] = useState(null);
  const save = useDebounced((title) => action.updateItem(task.id, { title }), 500);
  const title = draft ?? task.title ?? '';

  // Drop the local draft once the saved title catches up with it: compared with the draft as
  // it is then, or a letter typed since this render would be lost.
  useEffect(() => {
    setDraft((d) => (d === task.title ? null : d));
  }, [task.title, draft]);

  return (
    <li className={`subtask ${task.status}`}>
      <input
        type="checkbox"
        className="check"
        checked={task.status === 'done'}
        onChange={() => action.setTaskStatus(task.id, task.status === 'open' ? 'done' : 'open')}
        aria-label={task.status === 'done' ? 'Mark subtask not done' : 'Mark subtask done'}
      />
      <input
        className="subtask-title"
        value={title}
        placeholder="Subtask"
        aria-label="Subtask"
        onChange={(e) => {
          setDraft(e.target.value);
          save(e.target.value);
        }}
        onBlur={() => save.flush()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save.flush();
            onDone();
          } else if (e.key === 'Backspace' && !title) {
            e.preventDefault();
            action.deleteItem(task.id);
            onDone();
          }
        }}
      />
      <button className="row-delete" onClick={() => action.deleteItem(task.id)} aria-label="Delete subtask" title="Delete subtask">
        <TrashIcon />
      </button>
    </li>
  );
}
