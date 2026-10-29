// Hybrid logical clock. A timestamp is "<ISO time>-<counter, 4 hex>-<node id, 16 hex>",
// so plain string comparison orders timestamps. The clock never moves backward and always
// moves past any timestamp it has received, so a device with a wrong wall clock cannot
// make its later changes sort before changes it has already seen.

const MAX_COUNTER = 0xffff;
const HLC_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9a-f]{16})$/;

export function isHlc(value) {
  return typeof value === 'string' && HLC_RE.test(value);
}

export function parseHlc(value) {
  const m = HLC_RE.exec(value);
  if (!m) throw new Error(`Invalid HLC timestamp: ${value}`);
  return { millis: Date.parse(m[1]), counter: parseInt(m[2], 16), node: m[3] };
}

export function formatHlc(millis, counter, node) {
  return `${new Date(millis).toISOString()}-${counter.toString(16).padStart(4, '0')}-${node}`;
}

export function hlcNode(value) {
  return value.slice(-16);
}

export function createClock(node, last = null, now = Date.now) {
  if (!/^[0-9a-f]{16}$/.test(node)) throw new Error(`Invalid node id: ${node}`);
  let millis = 0;
  let counter = 0;
  if (last) ({ millis, counter } = parseHlc(last));

  function advance(nextMillis, nextCounter) {
    // Too many events in one millisecond: borrow the next millisecond instead of overflowing.
    if (nextCounter > MAX_COUNTER) {
      nextMillis += 1;
      nextCounter = 0;
    }
    millis = nextMillis;
    counter = nextCounter;
  }

  return {
    // Timestamp for a local event.
    send() {
      const phys = now();
      if (phys > millis) advance(phys, 0);
      else advance(millis, counter + 1);
      return formatHlc(millis, counter, node);
    },
    // Fold in a timestamp received from another device.
    recv(remote) {
      const r = parseHlc(remote);
      const phys = now();
      const next = Math.max(millis, r.millis, phys);
      if (next === millis && next === r.millis) advance(next, Math.max(counter, r.counter) + 1);
      else if (next === millis) advance(next, counter + 1);
      else if (next === r.millis) advance(next, r.counter + 1);
      else advance(next, 0);
    },
    current() {
      return formatHlc(millis, counter, node);
    },
  };
}
