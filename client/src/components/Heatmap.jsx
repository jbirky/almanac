import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { addDays, longDay, shortMonth, weekday } from '@almanac/shared';
import { useQuery } from '../lib/hooks.js';

const WEEKS_BACK = 52;
const WEEKS_AHEAD = 4;

function describe(date, today, c) {
  const parts = [longDay(date) + (date === today ? ' (today)' : '')];
  if (c?.done) parts.push(`${c.done} done`);
  if (c?.words) parts.push(`${c.words} ${c.words === 1 ? 'word' : 'words'}`);
  if (c?.due) parts.push(`${c.due} due`);
  return parts.join(' · ');
}

// A year of days as a GitHub-style grid, one column per week with Sunday on top: shaded by
// tasks finished, outlined where the journal has writing, dotted where something is due.
// Arrow keys move the selected day. `matches`, a set of dates, highlights search results.
export function Heatmap({ day, today, onSelect, matches }) {
  const first = addDays(today, -weekday(today) - 7 * WEEKS_BACK);
  const end = addDays(first, 7 * (WEEKS_BACK + WEEKS_AHEAD + 1));
  const days = useMemo(() => {
    const list = [];
    for (let d = first; d < end; d = addDays(d, 1)) list.push(d);
    return list;
  }, [first, end]);
  const counts = useQuery('heatmap', [first, end, today], ['items', 'bodies']) ?? {};
  const max = Math.max(4, ...Object.values(counts).map((c) => c.done));
  const columns = days.length / 7;
  const tabbable = day >= first && day < end ? day : today;
  const scroller = useRef(null);
  const stepped = useRef(false);

  const months = [];
  for (let col = 0; col < columns; col++) {
    const firstOfMonth = days.slice(col * 7, col * 7 + 7).find((d) => d.endsWith('-01'));
    if (firstOfMonth && (!months.length || col - months.at(-1).col >= 3)) months.push({ col, label: shortMonth(firstOfMonth) });
  }

  // Start scrolled to the end, so the weeks ahead and the recent past are in view.
  useLayoutEffect(() => {
    scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);

  // Keep the selected day in view, and keep focus on it while stepping with the arrow keys.
  useEffect(() => {
    const cell = scroller.current.querySelector(`[data-date="${day}"]`);
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (stepped.current) {
      stepped.current = false;
      cell?.focus();
    }
  }, [day]);

  const onKeyDown = (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    if (!step || !e.target.dataset.date) return;
    e.preventDefault();
    const next = addDays(e.target.dataset.date, step);
    if (next < first || next >= end) return;
    onSelect(next);
    // Stepping onto the selected day (from a search match, say) doesn't change it, so focus here.
    if (next === day) scroller.current.querySelector(`[data-date="${next}"]`)?.focus();
    else stepped.current = true;
  };

  return (
    <div className="heatmap">
      <div className="heatmap-weekdays" aria-hidden="true">
        <span />
        <span>Mon</span>
        <span />
        <span>Wed</span>
        <span />
        <span>Fri</span>
        <span />
      </div>
      <div className="heatmap-scroll" ref={scroller} style={{ '--columns': columns }}>
        <div className="heatmap-months" aria-hidden="true">
          {months.map((m) => (
            <span key={m.col} style={{ gridColumn: m.col + 1 }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="heatmap-grid" role="group" aria-label="Calendar" onKeyDown={onKeyDown}>
          {days.map((d) => {
            const c = counts[d];
            const level = c?.done ? Math.ceil((4 * c.done) / max) : 0;
            const classes = [
              'cell',
              `l${level}`,
              c?.words && 'wrote',
              c?.due && 'due',
              d > today && 'future',
              d === today && 'today',
              matches && (matches.has(d) ? 'match' : 'dim'),
            ];
            return (
              <button
                key={d}
                className={classes.filter(Boolean).join(' ')}
                data-date={d}
                tabIndex={d === tabbable ? 0 : -1}
                aria-current={d === day ? 'true' : undefined}
                title={describe(d, today, c)}
                onClick={() => onSelect(d)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
