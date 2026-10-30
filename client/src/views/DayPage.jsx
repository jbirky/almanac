import { addDays, fullDay, journalId, shortDay } from '@almanac/shared';
import { NoteEditor } from '../components/editor/NoteEditor.jsx';
import { EventsPanel } from '../components/EventsPanel.jsx';
import { PinnedBoxes } from '../components/PinnedBoxes.jsx';
import { TaskInput, TaskRow } from '../components/TaskRow.jsx';
import { action } from '../lib/db.js';
import { useQuery } from '../lib/hooks.js';

const NEAR = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' };

// One day: its events from the calendars the server reads, its "Due" panel, the notes boxes
// pinned on earlier days, then the day's journal. A task typed into the journal has no due date
// until it's given one.
export function DayPage({ day, today, views, onSelect, onShowCalendar }) {
  const tasks = useQuery('dayTasks', [day, today]);
  const calendars = useQuery('calendars', [], ['calendars']);
  const events = useQuery('dayEvents', [day], ['calendars', 'events']);
  const near = [-1, 0, 1].find((n) => addDays(today, n) === day);
  const when = near !== undefined ? NEAR[near].toLowerCase() : `on ${shortDay(day, today)}`;
  return (
    <article className="day-page">
      <header className="day-header">
        <div className="day-header-top">
          <p className="kicker">{near !== undefined ? NEAR[near] : ' '}</p>
          {views}
        </div>
        <div className="day-header-main">
          <h1>
            <button className="day-title" onClick={onShowCalendar} title="Show calendar">
              {fullDay(day, today)}
            </button>
          </h1>
          <nav className="day-nav" aria-label="Days">
            <button onClick={() => onSelect(addDays(day, -1))} aria-label="Previous day">
              ‹
            </button>
            {day !== today && <button onClick={() => onSelect(today)}>Today</button>}
            <button onClick={() => onSelect(addDays(day, 1))} aria-label="Next day">
              ›
            </button>
          </nav>
        </div>
      </header>
      <EventsPanel day={day} when={when} calendars={calendars} events={events} />
      <DuePanel day={day} today={today} when={when} tasks={tasks} />
      <PinnedBoxes day={day} today={today} onSelect={onSelect} />
      <NoteEditor
        noteId={journalId(day)}
        ensure={() => action.ensureJournal(day)}
        day={day}
        placeholder="Write about the day. Type [] for a task, #meeting for a notes box, or $x^2$ for math."
      />
    </article>
  );
}

// The tasks due that day, with a box to add one, then on today's page what's overdue, then
// anything else finished that day.
function DuePanel({ day, today, when, tasks }) {
  const list = (rows, name) => (
    <ul className="task-list" aria-label={name}>
      {rows.map((t) => (
        <TaskRow key={t.id} task={t} today={today} day={day} />
      ))}
    </ul>
  );
  return (
    <section className="due-panel" aria-label={`Due ${when}`}>
      <h2>Due {when}</h2>
      {tasks && (tasks.due.length ? list(tasks.due, `Due ${when}`) : <p className="empty">Nothing due.</p>)}
      <TaskInput today={today} due={day} label={`Add a task due ${when}`} placeholder={`Add a task due ${when}`} />
      {tasks?.overdue.length > 0 && (
        <>
          <h3>Overdue</h3>
          {list(tasks.overdue, 'Overdue')}
        </>
      )}
      {tasks?.finished.length > 0 && (
        <>
          <h3>Also finished</h3>
          {list(tasks.finished, 'Also finished')}
        </>
      )}
    </section>
  );
}
