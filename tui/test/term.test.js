import { describe, expect, it, vi } from 'vitest';
import { askBackground, terminalInput } from '../src/term.js';
import { FakeStdin } from './helpers.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('the terminal around Ink', () => {
  it('takes the terminal’s replies out of the keys, as events', async () => {
    const stdin = new FakeStdin();
    const term = terminalInput(stdin);
    const keys = [];
    term.input.on('data', (chunk) => keys.push(chunk.toString()));
    const focus = vi.fn();
    const background = vi.fn();
    term.events.on('focus', focus);
    term.events.on('background', background);

    stdin.write(Buffer.from('j\x1b[I\x1b]11;rgb:1717/1616/1414\x1b\\k\x1b[?62;22cx'));
    await tick();
    expect(keys.join('')).toBe('jkx');
    expect(focus).toHaveBeenCalledOnce();
    expect(background).toHaveBeenCalledWith([23, 22, 20]);
    term.close();
  });

  it('keeps a character split across two reads whole', async () => {
    const stdin = new FakeStdin();
    const term = terminalInput(stdin);
    const keys = [];
    term.input.on('data', (chunk) => keys.push(chunk.toString()));
    const bytes = Buffer.from('é');
    stdin.write(bytes.subarray(0, 1));
    stdin.write(bytes.subarray(1));
    await tick();
    expect(keys.join('')).toBe('é');
    term.close();
  });

  it('learns the background color, or that the terminal won’t say', async () => {
    const stdin = new FakeStdin();
    const term = terminalInput(stdin);
    const out = { write: vi.fn() };

    const asked = askBackground(out, term.events);
    stdin.write(Buffer.from('\x1b]11;rgb:fbfb/fafa/f8f8\x07'));
    await expect(asked).resolves.toEqual([251, 250, 248]);

    // A terminal that ignores the question still answers the device attributes after it.
    const ignored = askBackground(out, term.events);
    stdin.write(Buffer.from('\x1b[?1;2c'));
    await expect(ignored).resolves.toBeNull();

    await expect(askBackground(out, term.events, 20)).resolves.toBeNull();
    expect(out.write).toHaveBeenCalledTimes(3);
    term.close();
  });
});
