// Small helpers used on both client and server (no Node or DOM-only APIs).

export function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId() {
  return randomHex(10);
}

export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Local calendar date as YYYY-MM-DD (tasks are scheduled and due on local dates).
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

// UTC ISO bounds [start, end) of a range of local dates, for querying done_at timestamps.
export function localDayBounds(startDate, endDateExclusive = addDays(startDate, 1)) {
  const toIso = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toISOString();
  };
  return [toIso(startDate), toIso(endDateExclusive)];
}

// Journal days have fixed ids, so two devices that start the same day offline create the
// same item and their entries merge instead of duplicating.
export function journalId(date) {
  return `journal-${date}`;
}

// "ubuntu.tail1234.ts.net:8787/" -> "https://ubuntu.tail1234.ts.net:8787". Null if it isn't an
// address: an https one, or http for the device itself.
export function normalizeServerUrl(text) {
  let value = text.trim().replace(/\/+$/, '');
  if (!/^[a-z]+:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
