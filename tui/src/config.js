import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where this machine keeps its copy and its settings, in the usual places: the copy, its lock and
// the socket other commands reach the running TUI by under ~/.local/share/almanac, the settings in
// ~/.config/almanac/config.json, and images opened in a viewer under ~/.cache/almanac/images.
export function locations(env = process.env) {
  const home = os.homedir();
  const dir = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'almanac');
  return {
    dir,
    db: path.join(dir, 'almanac.sqlite3'),
    lock: path.join(dir, 'almanac.lock'),
    socket: path.join(dir, 'almanac.sock'),
    // This machine's own conveniences: the left pane's width, which tasks show their subtasks.
    state: path.join(dir, 'state.json'),
    config: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'almanac', 'config.json'),
    images: path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'almanac', 'images'),
  };
}

// The settings: `server`, the address to sync with; `scheme`, a color scheme's accent as on the
// web ("ocean"); `mode`, "light" or "dark" when the terminal's own can't be told.
export function readConfig(file) {
  return readJson(file);
}

export function writeConfig(file, patch) {
  writeJson(file, { ...readJson(file), ...patch });
}

export function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Written whole to a file beside it, then moved into place, so it's never half written.
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

// Whether the server answers at `url`, as { ok } or { ok: false, message }, as the Android app's
// Settings checks it.
export async function checkServer(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, message: `It answered ${res.status}.` };
    return (await res.json()).ok ? { ok: true } : { ok: false, message: "It answered, but it isn't Almanac." };
  } catch {
    return { ok: false, message: "Couldn't reach it. Is Tailscale on, and is the address right?" };
  }
}
