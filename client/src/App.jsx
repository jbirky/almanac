import { useCallback, useEffect, useRef, useState } from 'react';
import { localDate } from '@almanac/shared';
import { Notices } from './components/Notices.jsx';
import { PANEL, Splitter } from './components/Splitter.jsx';
import { ViewSwitch } from './components/ViewSwitch.jsx';
import { DayPage } from './views/DayPage.jsx';
import { LabelPage, pickLabel } from './views/LabelPage.jsx';
import { Overview } from './views/Overview.jsx';
import { SettingsPage } from './views/SettingsPage.jsx';
import { navigate, useQuery, useRoute, useToday } from './lib/hooks.js';
import { startWidget } from './lib/widget.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The left panel's width is this browser's own: kept in its storage, not synced.
const WIDTH_KEY = 'almanac.panelWidth';

function savedWidth() {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    return width >= PANEL.min ? width : PANEL.initial;
  } catch {
    return PANEL.initial;
  }
}

const isTyping = (el) => el instanceof Element && el.closest('input, textarea, [contenteditable="true"]') !== null;

// Two panels: the calendar and open tasks on the left, the journal on the right, either one
// day (#/2026-10-20, or today without one) or one label's boxes across days (#/label/<id>, or
// the label used most recently without one); or the settings (#/settings) in its place. On a phone only the journal fits, and the left
// panel slides over it on demand.
export function App() {
  const today = useToday();
  const { parts } = useRoute();
  const view = { label: 'label', settings: 'settings' }[parts[0]] ?? 'day';
  const labels = useQuery('labels');
  const label = view === 'label' ? pickLabel(labels, parts[1] && decodeURIComponent(parts[1])) : null;
  const routeDay = DATE.test(parts[0] ?? '') ? parts[0] : today;
  // Where each side of the view switch goes back to.
  const [lastDay, setLastDay] = useState(routeDay);
  const [lastLabel, setLastLabel] = useState(null);
  if (view === 'day' && routeDay !== lastDay) setLastDay(routeDay);
  if (label && label.id !== lastLabel) setLastLabel(label.id);
  const day = view === 'day' ? routeDay : lastDay;
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(savedWidth);
  const addRef = useRef(null);
  const searchRef = useRef(null);

  const select = useCallback(
    (date) => {
      navigate(date === today ? '/' : `/${date}`);
      setOverviewOpen(false);
    },
    [today],
  );

  // Opens the left panel (a no-op on a wide screen) and focuses something in it.
  const showOverview = useCallback((focus) => {
    setOverviewOpen(true);
    requestAnimationFrame(() => focus()?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        showOverview(() => addRef.current);
      } else if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        showOverview(() => searchRef.current);
      } else if (e.key === 'Escape') {
        setOverviewOpen(false);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [showOverview]);

  // The Android app's Today widget: its + opens the task box, and a task in it opens its day.
  useEffect(
    () =>
      startWidget({
        onOpen: ({ place, date }) => {
          if (place === 'add') showOverview(() => addRef.current);
          else if (date) navigate(date === localDate() ? '/' : `/${date}`);
        },
      }),
    [showOverview],
  );

  const showCalendar = () => showOverview(() => document.querySelector('.heatmap .cell[aria-current]'));
  const views = (
    <ViewSwitch
      view={view}
      dayHref={day === today ? '#/' : `#/${day}`}
      labelHref={lastLabel ? `#/label/${encodeURIComponent(lastLabel)}` : '#/label'}
    />
  );

  const keepWidth = (width) => {
    setPanelWidth(width);
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Storage unavailable: the width lasts until the page reloads.
    }
  };

  return (
    <div className={`app${overviewOpen ? ' overview-open' : ''}`} style={{ '--panel-width': `${panelWidth}px` }}>
      <Overview
        day={day}
        today={today}
        label={label}
        onSelect={select}
        onClose={() => setOverviewOpen(false)}
        addRef={addRef}
        searchRef={searchRef}
      />
      <Splitter width={panelWidth} onChange={setPanelWidth} onCommit={keepWidth} />
      <main>
        {view === 'settings' ? (
          <SettingsPage views={views} />
        ) : view === 'label' ? (
          <LabelPage
            key={label?.id}
            label={label}
            labels={labels}
            today={today}
            views={views}
            onSelect={select}
            onShowCalendar={showCalendar}
          />
        ) : (
          <DayPage key={day} day={day} today={today} views={views} onSelect={select} onShowCalendar={showCalendar} />
        )}
      </main>
      <Notices />
    </div>
  );
}
