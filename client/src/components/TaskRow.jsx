import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { matchCategory, parseCapture, relativeDay } from '@almanac/shared';
import { action } from '../lib/db.js';
import { useQuery } from '../lib/hooks.js';
import { CalendarIcon, TagIcon, TrashIcon } from './icons.jsx';
import { SubtaskChip, SubtaskList, useSubtasksOpen } from './Subtasks.jsx';

// One task: checkbox, title (click to edit), subtasks, category, due date and delete, with its
// subtasks under it when they're open. `day` is the date the list is about; a due date equal to
// it is shown only on hover. In a list already grouped by category, `quietCategory` shows the
// category only on hover too. `grip`, in a list that can be reordered, goes in the margin.
export function TaskRow({ task, today, day = today, quietCategory = false, grip = null, className = '' }) {
  const [editing, setEditing] = useState(false);
  // Where to put the cursor in the title box: a character offset, or null for the end.
  const [caret, setCaret] = useState(null);
  const subtasksOpen = useSubtasksOpen(task.id);
  const isOpen = task.status === 'open';
  const edit = (at) => {
    setCaret(at);
    setEditing(true);
  };
  return (
    <li className={`task-item${className}`} data-task={task.id}>
      <div className={`task-row ${task.status}`}>
        {grip}
        <input
          type="checkbox"
          className="check"
          checked={!isOpen}
          onChange={() => action.setTaskStatus(task.id, isOpen ? 'done' : 'open')}
          aria-label={isOpen ? 'Mark done' : 'Mark not done'}
        />
        {editing ? (
          <TitleInput task={task} caret={caret} onClose={() => setEditing(false)} />
        ) : (
          // Text rather than a <button>, so a click can tell which character it landed on.
          <span
            className="task-title"
            role="button"
            tabIndex={0}
            onClick={(e) => edit(caretOffset(e))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                edit(null);
              }
            }}
          >
            {task.title || <span className="muted">Untitled task</span>}
          </span>
        )}
        <SubtaskChip task={task} isOpen={subtasksOpen} />
        <CategoryChip value={task.category} quiet={quietCategory} onChange={(name) => action.setCategory(task.id, name)} />
        <span className="date-slot">
          {isOpen && (
            <DateChip value={task.due} today={today} quiet={task.due === day} onChange={(due) => action.updateItem(task.id, { due })} />
          )}
        </span>
        <button className="row-delete" onClick={() => action.deleteTask(task.id)} aria-label="Delete task" title="Delete task">
          <TrashIcon />
        </button>
      </div>
      {subtasksOpen && <SubtaskList parentId={task.id} />}
    </li>
  );
}

// The character offset a click landed on in a line of text, or null if it missed the text.
function caretOffset(e) {
  const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (pos) return pos.offsetNode.nodeType === 3 ? pos.offset : null;
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  return range?.startContainer.nodeType === 3 ? range.startOffset : null;
}

function TitleInput({ task, caret, onClose }) {
  const [value, setValue] = useState(task.title ?? '');
  const ref = useRef(null);

  // Focus with the cursor where the title was clicked.
  useLayoutEffect(() => {
    const el = ref.current;
    el.focus();
    const at = caret ?? el.value.length;
    el.setSelectionRange(at, at);
    // Runs once, when the box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (value.trim() !== (task.title ?? '')) action.updateItem(task.id, { title: value.trim() });
    onClose();
  };
  return (
    <input
      ref={ref}
      className="task-title-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') onClose();
      }}
      aria-label="Task title"
    />
  );
}

// Opens the browser's date picker. False if it can't (not supported, or already open), and then
// the browser's own handling of the click or key applies.
const openPicker = (input) => {
  try {
    input.showPicker();
    return true;
  } catch {
    return false;
  }
};

// A due date as a small chip over an invisible date input, so a click opens the browser's
// date picker. The × after a date removes it. A quiet chip shows only on hover, unless the
// date has passed.
export function DateChip({ value, today, quiet = false, onChange }) {
  const label = value ? relativeDay(value, today) : null;
  const late = value && value < today;
  return (
    <span className={`date-chip${late ? ' late' : ''}${quiet && !late ? ' quiet' : ''}${value ? '' : ' empty'}`}>
      <span className="date-pick" title={value ? undefined : 'Add a due date'}>
        {label ?? <CalendarIcon />}
        <input
          type="date"
          value={value ?? ''}
          onChange={(e) => {
            const next = e.target.value;
            // Typing a year digit by digit passes through years like 0002; wait for a real one.
            if (!next || next >= '1900') onChange(next || null);
          }}
          onClick={(e) => {
            // Firefox's own handling of the same click on the date field closes the picker again.
            if (openPicker(e.currentTarget)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker(e.currentTarget);
            }
          }}
          aria-label={value ? `Due ${label}. Change date` : 'Add a due date'}
        />
      </span>
      {value && (
        <button className="date-clear" onClick={() => onChange(null)} aria-label="Remove due date" title="Remove due date">
          ×
        </button>
      )}
    </span>
  );
}

// A task's category as a chip. A click turns it into a box for typing a new category or
// picking an existing one; Enter or leaving the box saves it, and an empty box removes it.
export function CategoryChip({ value, quiet = false, onChange }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CategoryInput
        value={value}
        onDone={(name) => {
          setEditing(false);
          if (name !== undefined && name !== (value ?? null)) onChange(name);
        }}
      />
    );
  }
  return (
    <button
      className={`category-chip${quiet ? ' quiet' : ''}${value ? '' : ' empty'}`}
      onClick={() => setEditing(true)}
      aria-label={value ? `Category ${value}. Change category` : 'Add a category'}
      title={value ? undefined : 'Add a category'}
    >
      {value || <TagIcon />}
    </button>
  );
}

function CategoryInput({ value, onDone }) {
  const categories = useQuery('categories');
  const listId = useId();
  const [text, setText] = useState(value ?? '');
  // Enter saves and unmounts the box; don't save again if a blur follows.
  const finished = useRef(false);
  const finish = (name) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };
  return (
    <>
      <input
        className="category-input"
        list={listId}
        value={text}
        autoFocus
        placeholder="Category"
        aria-label="Category"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(matchCategory(text, categories))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(matchCategory(text, categories));
          } else if (e.key === 'Escape') {
            finish(undefined);
          }
        }}
      />
      <datalist id={listId}>
        {categories?.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

// The one-line task entry: "draft intro fri #paper". Shows the date and category it read
// from the text before you press Enter, so a stray word read as a date is visible, and so is
// a category that doesn't exist yet. Without a date in the text, the task is due on `due`.
export function TaskInput({ inputRef, today, due = null, label = 'New task', placeholder = 'Add a task, e.g. "draft intro fri #paper"' }) {
  const [text, setText] = useState('');
  const categories = useQuery('categories');
  const parsed = useMemo(() => (text.trim() ? parseCapture(text) : null), [text]);
  const category = parsed?.category ? matchCategory(parsed.category, categories) : null;
  const isNew = category && !categories?.includes(category);
  const submit = (e) => {
    e.preventDefault();
    if (!parsed?.title) return;
    action.captureTask({ title: parsed.title, due: parsed.due ?? due, category });
    setText('');
  };
  return (
    <form className="task-input" onSubmit={submit}>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {(parsed?.due || category) && (
        <span className="capture-preview" aria-live="polite">
          {category && (
            <span className="category-chip">
              {category}
              {isNew && <span className="new"> · new</span>}
            </span>
          )}
          {parsed.due && <span className="date-chip">{relativeDay(parsed.due, today)}</span>}
        </span>
      )}
    </form>
  );
}
