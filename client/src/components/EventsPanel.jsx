import { eventTime } from '@almanac/shared';

const URL_TEXT = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/;

// Text with its web addresses as links, as a meeting's location or notes often have one.
function Linked({ text }) {
  return text.split(URL_TEXT).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

// The day's events from the calendars the server reads (Settings lists them), above its Due
// panel; not there at all without any calendars. `when` is "today", "on Thu, Oct 29" and so on.
export function EventsPanel({ day, when, calendars, events }) {
  if (!calendars?.length) return null;
  return (
    <section className="events-panel" aria-label={`Events ${when}`}>
      <h2>Events {when}</h2>
      {events &&
        (events.length ? (
          <ul className="event-list">
            {events.map((e) => (
              <EventRow key={e.id} event={e} day={day} calendar={calendars.length > 1 ? e.calendar : null} />
            ))}
          </ul>
        ) : (
          <p className="empty">No events.</p>
        ))}
    </section>
  );
}

// An event: when, what and where, its calendar's name when there are several, and its notes to
// open.
function EventRow({ event, day, calendar }) {
  const where = [event.location, calendar].filter(Boolean);
  return (
    <li className="event-row">
      <span className="event-time">{eventTime(event, day)}</span>
      <div className="event-main">
        <span className="event-title">{event.title ?? '(No title)'}</span>
        {where.length > 0 && (
          <span className="event-where">
            {where.map((text, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <Linked text={text} />
              </span>
            ))}
          </span>
        )}
        {(event.description || event.url) && (
          <details className="event-notes">
            <summary>Notes</summary>
            {event.description && (
              <p>
                <Linked text={event.description} />
              </p>
            )}
            {event.url && (
              <p>
                <Linked text={event.url} />
              </p>
            )}
          </details>
        )}
      </div>
    </li>
  );
}
