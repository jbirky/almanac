import { useEffect, useRef, useState } from 'react';
import { localDate } from '@almanac/shared';
import { onChange, onStatus, query } from './db.js';

// Runs a worker query and re-runs it whenever one of `tables` changes.
// Returns undefined until the first result arrives.
export function useQuery(name, args = [], tables = ['items', 'links', 'props']) {
  const [data, setData] = useState(undefined);
  const key = JSON.stringify([name, args]);
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      query[name](...args).then((result) => {
        if (alive && mine === seq) setData(result);
      });
    };
    run();
    const off = onChange((change) => {
      if (change.tables.some((t) => tables.includes(t))) run();
    });
    return () => {
      alive = false;
      off();
    };
    // `key` covers name and args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

export function useSyncStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => onStatus(setStatus), []);
  return status;
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

export function useRoute() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  const [path, search = ''] = hash.replace(/^#/, '').split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(search) };
}

export function navigate(to) {
  location.hash = to;
}

// Calls `fn` with the latest arguments after `ms` of quiet; `flush` runs it immediately.
// A pending call still runs if the component unmounts or the page is hidden, so an edit
// made just before navigating away is saved.
export function useDebounced(fn, ms) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef(null);
  const lastArgs = useRef(null);
  useEffect(() => {
    const flushPending = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      fnRef.current(...lastArgs.current);
    };
    const onHide = () => document.visibilityState === 'hidden' && flushPending();
    document.addEventListener('visibilitychange', onHide);
    addEventListener('pagehide', flushPending);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, []);
  const run = (...args) => {
    lastArgs.current = args;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fnRef.current(...args);
    }, ms);
  };
  run.flush = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    fnRef.current(...lastArgs.current);
  };
  return run;
}
