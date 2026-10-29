import { journalId, shortDay } from '@almanac/shared';
import { BoxEditor, useBoxesById } from './editor/BoxEditor.jsx';
import { useBodyDoc } from './editor/NoteEditor.jsx';
import { PinIcon } from './icons.jsx';
import { colorProps } from '../lib/color.js';
import { action } from '../lib/db.js';
import { useQuery } from '../lib/hooks.js';

// The notes boxes pinned on earlier days, at the top of a day's page. Each is the box itself, in
// its own day's journal, to read and write in here; Unpin takes it off this day and the ones
// after.
export function PinnedBoxes({ day, today, onSelect }) {
  const pins = useQuery('pinnedBoxes', [day]);
  const labels = useQuery('labels');
  if (!pins?.length) return null;
  const byDate = new Map();
  for (const pin of pins) byDate.set(pin.date, [...(byDate.get(pin.date) ?? []), pin.box]);
  return (
    <section className="pinned-boxes" aria-label="Pinned">
      {[...byDate].map(([date, ids]) => (
        <PinnedFrom key={date} date={date} ids={ids} day={day} today={today} labels={labels ?? []} onSelect={onSelect} />
      ))}
    </section>
  );
}

// The boxes one earlier day pins to this one.
function PinnedFrom({ date, ids, day, today, labels, onSelect }) {
  const noteId = journalId(date);
  const doc = useBodyDoc(noteId);
  const boxes = useBoxesById(doc, ids);
  const from = shortDay(date, today);
  return boxes.map((box) => {
    const id = box.getAttribute('id');
    const label = labels.find((l) => l.id === box.getAttribute('label')) ?? null;
    return (
      <div key={id} className={`note-box pinned${label ? '' : ' unlabeled'}`} {...colorProps(label?.color)}>
        <div className="note-box-header">
          {label && (
            <span className="label-chip">
              <span className="label-dot" aria-hidden="true" />
              {label.name}
            </span>
          )}
          <span className="pinned-from">
            <PinIcon />
            <button onClick={() => onSelect(date)} title="Open the day it's on">
              {from}
            </button>
          </span>
          <button className="unpin" onClick={() => action.unpinBox(date, id, day)} title="Stop showing it here and on the days after">
            Unpin
          </button>
        </div>
        {/* Emptied here, it stays: it's removed from its own day. */}
        <BoxEditor
          box={box}
          noteId={noteId}
          day={day}
          label={`${label?.name ?? 'Notes'}, pinned from ${from}`}
          onRemove={() => {}}
        />
      </div>
    );
  });
}
