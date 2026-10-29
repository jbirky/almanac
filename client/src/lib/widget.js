import { registerPlugin } from '@capacitor/core';
import { localDate } from '@almanac/shared';
import { action, onChange, query } from './db.js';
import { IS_APP } from './server.js';
import { checkOffs, widgetSnapshot } from './widget-data.js';

// The Android app's side of its Today widget (the AlmanacWidget plugin, in client/android): it
// keeps the widget's copy of the tasks up to date while the app is open, checks off what was
// checked off in the widget each time the app comes back, and says where a tap on the widget
// asked to open the app. Nothing here runs in a browser.

const TABLES = ['items', 'props', 'links'];
const SETTLE_MS = 500;

// The plugin answers to any method name, `then` too, so it's never handed through a promise,
// where it would pass for one.
const plugin = IS_APP ? registerPlugin('AlmanacWidget') : null;

// Starts the widget's side of the app. `onOpen` gets where a tap on the widget asked to go:
// { place: 'add' } or { place: 'day', date }. Returns a function that stops it.
export function startWidget({ onOpen }) {
  let stopped = false;
  const offs = [];
  let timer = null;

  const refresh = async () => {
    clearTimeout(timer);
    timer = null;
    if (stopped) return;
    const tasks = await query.openTasks();
    await plugin.update({ snapshot: JSON.stringify(widgetSnapshot(tasks, localDate(), Date.now())) });
  };
  const soon = () => {
    if (!timer) timer = setTimeout(refresh, SETTLE_MS);
  };
  // Tasks checked off in the widget, checked off here too, where they sync.
  const applyCheckOffs = async () => {
    if (stopped) return;
    const { ids } = await plugin.takePending();
    if (!ids.length) return;
    const tasks = new Map();
    for (const id of ids) tasks.set(id, await query.task(id));
    for (const id of checkOffs(ids, (id) => tasks.get(id))) await action.setTaskStatus(id, 'done');
    soon();
  };

  if (!plugin) return () => {};
  // Listening first, so nothing that changes while it starts (the first sync) is missed.
  offs.push(onChange((change) => change.tables.some((t) => TABLES.includes(t)) && soon()));
  (async () => {
    // Back in the app, the widget may have checked tasks off, and the day may have changed.
    offs.push(await plugin.addListener('resume', () => applyCheckOffs().then(soon)));
    offs.push(await plugin.addListener('launch', onOpen));
    await applyCheckOffs();
    await refresh();
    const launch = await plugin.takeLaunch();
    if (launch.place) onOpen(launch);
  })();

  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const off of offs) (off.remove ?? off)();
  };
}

// Asks the home screen to add the widget. Resolves with whether it could ask.
export async function pinWidget() {
  if (!plugin) return false;
  return (await plugin.pin()).asked;
}
