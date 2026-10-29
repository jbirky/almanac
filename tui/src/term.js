import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

// What the TUI asks of the terminal around Ink: its background color, to pick light or dark
// shades that suit it, and word when it gains focus, to sync then.

const FOCUS_ON = '\x1b[?1004h';
const FOCUS_OFF = '\x1b[?1004l';
// OSC 11 asks for the background color. Primary device attributes (DA1) come after it, and
// every terminal answers those, so a terminal that ignores OSC 11 is known to at once.
const ASK_BACKGROUND = '\x1b]11;?\x1b\\\x1b[c';

// The terminal's replies, taken out of the keys before Ink reads them.
// eslint-disable-next-line no-control-regex
const REPLY = /\x1b\[(I|O)|\x1b\]11;rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\x07|\x1b\\)|\x1b\[\?[\d;]*c/gi;

// A stand-in for stdin that Ink reads keys from: what the terminal sends, less its replies,
// which come out as events instead: 'focus', 'blur', 'background' ([r, g, b]) and 'attributes'.
export function terminalInput(stdin) {
  const input = new PassThrough();
  const events = new EventEmitter();
  const decoder = new StringDecoder('utf8');
  input.isTTY = stdin.isTTY;
  input.setRawMode = (mode) => {
    stdin.setRawMode?.(mode);
    return input;
  };
  input.ref = () => (stdin.ref(), input);
  input.unref = () => (stdin.unref(), input);
  const onData = (chunk) => {
    const text = decoder.write(chunk).replace(REPLY, (match, focus, r, g, b) => {
      if (focus) events.emit(focus === 'I' ? 'focus' : 'blur');
      else if (r) events.emit('background', [r, g, b].map((hex) => Math.round((parseInt(hex, 16) / (16 ** hex.length - 1)) * 255)));
      else events.emit('attributes');
      return '';
    });
    if (text) input.write(text);
  };
  stdin.on('data', onData);
  return {
    input,
    events,
    close() {
      stdin.off('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
    },
  };
}

// The terminal's background color as [r, g, b], or null if it won't say.
export function askBackground(output, events, timeout = 300) {
  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer);
      events.off('background', onBackground);
      events.off('attributes', onAttributes);
      resolve(value);
    };
    const onBackground = (rgb) => done(rgb);
    const onAttributes = () => done(null);
    const timer = setTimeout(() => done(null), timeout);
    events.on('background', onBackground);
    events.on('attributes', onAttributes);
    output.write(ASK_BACKGROUND);
  });
}

export const focusReports = (output, on) => output.write(on ? FOCUS_ON : FOCUS_OFF);
