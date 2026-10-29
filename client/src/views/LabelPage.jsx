import { useEffect, useRef, useState } from 'react';
import { addDays, journalId, shortDay } from '@almanac/shared';
import { BoxEditor, addBox, removeBox, useBoxes } from '../components/editor/BoxEditor.jsx';
import { LabelEditor } from '../components/editor/NoteBox.jsx';
import { useBodyDoc } from '../components/editor/NoteEditor.jsx';
import { colorProps } from '../lib/color.js';
import { action } from '../lib/db.js';
import { useQuery } from '../lib/hooks.js';

const NEAR = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' };
const PAGE = 14;

// The label a "by label" link shows: the one it names, else the one used most recently.
// Undefined while labels load, null when there are none.
export function pickLabel(labels, id) {
  if (!labels) return undefined;
  const byLast = labels.filter((l) => l.last).sort((a, b) => b.last.localeCompare(a.last));
  return labels.find((l) => l.id === id) ?? byLast[0] ?? labels[0] ?? null;
}

// The journal by label: one section per day with a box under it, newest first, each holding
// that day's boxes to read and edit in place. Today always has a section, to start one in.
export function LabelPage({ label, labels, today, views, onSelect, onShowCalendar }) {
  const dates = useQuery('labelDays', [label?.id ?? null]);
  const [count, setCount] = useState(PAGE);

  if (label === undefined) return <article className="day-page" aria-busy="true" />;
  if (!label) {
    return (
      <article className="day-page label-page">
        <header className="day-header">
          <div className="day-header-top">
            <p className="kicker"> </p>
            {views}
          </div>
          <h1>No labels yet</h1>
        </header>
        <p className="empty">
          Put notes in a box under a label to read them here by label: type #meeting at the start of a line in a
          day&apos;s journal, or click + Notes box under it.
        </p>
      </article>
    );
  }

  const days = dates && [...new Set([today, ...dates])].sort().reverse();
  return (
    <article className="day-page label-page" {...colorProps(label.color)}>
      <header className="day-header">
        <div className="day-header-top">
          <p className="kicker">
            {label.days ? `${label.days} ${label.days === 1 ? 'day' : 'days'}` : 'No notes yet'}
          </p>
          {views}
        </div>
        <div className="day-header-main">
          <h1>
            <button className="day-title label-title" onClick={onShowCalendar} title="Show calendar">
              <span className="label-dot" aria-hidden="true" />
              {label.name}
            </button>
          </h1>
          <EditLabel label={label} labels={labels} />
        </div>
      </header>
      <nav className="label-tabs" aria-label="Labels">
        {labels.map((l) => (
          <a
            key={l.id}
            className="label-chip"
            {...colorProps(l.color)}
            href={`#/label/${encodeURIComponent(l.id)}`}
            aria-current={l.id === label.id ? 'page' : undefined}
          >
            <span className="label-dot" aria-hidden="true" />
            {l.name}
          </a>
        ))}
      </nav>
      {days?.slice(0, count).map((date) => (
        <LabelDay key={date} date={date} label={label} today={today} onSelect={onSelect} />
      ))}
      {days?.length > count && (
        <button className="more-days" onClick={() => setCount(count + PAGE)}>
          Show older days
        </button>
      )}
    </article>
  );
}

// "Edit label": the label's name and color, changed everywhere, in a popover.
function EditLabel({ label, labels }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current?.contains(e.target) || setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="edit-label" ref={ref}>
      <button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        Edit label
      </button>
      {open && (
        <div className="label-picker" role="dialog" aria-label={`Edit label ${label.name}`}>
          <LabelEditor
            label={label}
            labels={labels}
            doneText="Done"
            onDone={() => setOpen(false)}
            onDeleted={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// One day's boxes under a label. Today's offers to start one when it has none.
function LabelDay({ date, label, today, onSelect }) {
  const noteId = journalId(date);
  const ensure = () => action.ensureJournal(date);
  const doc = useBodyDoc(noteId, ensure);
  const boxes = useBoxes(doc, label.id);
  const isToday = date === today;
  const near = [-1, 0, 1].find((n) => addDays(today, n) === date);
  const day = shortDay(date, today);

  if (!doc || (!boxes.length && !isToday)) return null;
  return (
    <section className="label-day" aria-label={day} data-date={date}>
      <h2>
        <button onClick={() => onSelect(date)} title="Open this day">
          {near !== undefined && <span className="near">{NEAR[near]}</span>}
          {day}
        </button>
      </h2>
      {boxes.map((box) => (
        <div key={keyOf(box)} className="note-box">
          <BoxEditor
            box={box}
            noteId={noteId}
            ensure={ensure}
            day={date}
            label={`${label.name} notes, ${day}`}
            onRemove={() => removeBox(doc, box)}
          />
        </div>
      ))}
      {!boxes.length && (
        <button className="add-note-box" onClick={() => addBox(doc, label.id)}>
          + Add to today
        </button>
      )}
    </section>
  );
}

// A stable React key for a Yjs element.
const keys = new WeakMap();
let nextKey = 0;
function keyOf(el) {
  if (!keys.has(el)) keys.set(el, ++nextKey);
  return keys.get(el);
}
