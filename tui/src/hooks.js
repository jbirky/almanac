import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { journalId, localDate } from '@almanac/shared';

export const ReplicaContext = createContext(null);
export const useReplica = () => useContext(ReplicaContext);

const TABLES = ['items', 'links', 'props'];

// A number that goes up whenever a write touches one of `tables`, here or synced in.
export function useVersion(tables = TABLES) {
  const replica = useReplica();
  const [version, setVersion] = useState(0);
  const key = tables.join(' ');
  useEffect(
    () =>
      replica.subscribe((change) => {
        if (change.tables.some((t) => tables.includes(t))) setVersion((v) => v + 1);
      }),
    // `key` stands for `tables`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replica, key],
  );
  return version;
}

// Runs a query, and again whenever a write touches one of `tables`. The copy is on this
// machine and better-sqlite3 answers at once, so unlike the web's there's no loading state.
export function useQuery(name, args = [], tables = TABLES) {
  const replica = useReplica();
  const version = useVersion(tables);
  const key = JSON.stringify(args);
  // `key` stands for `args`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => replica.queries[name](...args), [replica, name, key, version]);
}

// The journals of `dates` open for editing (see journal/bodies.js), as a Map of date to session,
// drawn again as any of them changes, here or on another device. A journal no longer asked for is
// let go once the screen stops showing it.
export function useJournals(dates) {
  const replica = useReplica();
  const held = useRef(new Map());
  const [, redraw] = useReducer((n) => n + 1, 0);
  // Opened as they're asked for, so they draw at once.
  for (const date of dates) {
    if (held.current.has(date)) continue;
    const session = replica.bodies.open(journalId(date), () => replica.act('ensureJournal', date));
    held.current.set(date, { session, off: session.subscribe(redraw) });
  }
  const key = dates.join(' ');
  useEffect(() => {
    const wanted = new Set(key.split(' '));
    for (const [date, { session, off }] of held.current) {
      if (wanted.has(date)) continue;
      off();
      session.release();
      held.current.delete(date);
    }
  }, [key]);
  useEffect(
    () => () => {
      for (const { session, off } of held.current.values()) {
        off();
        session.release();
      }
      held.current.clear();
    },
    [],
  );
  return new Map(dates.map((date) => [date, held.current.get(date).session]));
}

export function useSyncStatus() {
  const replica = useReplica();
  return useSyncExternalStore(replica.onStatus, () => replica.status);
}

// Today's local date, updated when the day rolls over.
export function useToday() {
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    const id = setInterval(() => setToday(localDate()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}
