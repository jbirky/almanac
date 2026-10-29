// Where sync goes. The web app syncs with the server it was loaded from. The Android app
// carries its own copy of the page, so it syncs with the address in Settings: by default the
// one it was built with (scripts/android/build), such as the server's tailnet address.
export const IS_APP = import.meta.env.VITE_APP === 'android';
const DEFAULT = import.meta.env.VITE_SERVER_URL ?? '';
const KEY = 'almanac.server';

// '' means the page's own server.
export function serverUrl() {
  if (!IS_APP) return '';
  try {
    return localStorage.getItem(KEY) || DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveServerUrl(url) {
  try {
    localStorage.setItem(KEY, url);
  } catch {
    // Storage unavailable: the address lasts until the app restarts.
  }
}

// Whether the server answers at `url`, as { ok } or { ok: false, message }.
export async function checkServer(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, message: `It answered ${res.status}.` };
    return (await res.json()).ok ? { ok: true } : { ok: false, message: "It answered, but it isn't Almanac." };
  } catch {
    return { ok: false, message: "Couldn't reach it. Is Tailscale on, and is the address right?" };
  }
}
