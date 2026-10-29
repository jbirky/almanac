import { describe, expect, it } from 'vitest';
import { editLine, inputPieces, inputText, insertText, lineInput } from '../src/input.js';
import { fit, lineWidth, piece, spread, truncate, width, wrap } from '../src/text.js';

const text = (line) => line.map((p) => p.text).join('');
const lines = (ls) => ls.map(text);

describe('measuring text in columns', () => {
  it('counts wide characters and emoji as two columns, and a joined emoji as one character', () => {
    expect(width('abc')).toBe(3);
    expect(width('観測')).toBe(4);
    expect(width('👩‍🔬')).toBe(2);
  });

  it('cuts a line to its width with an ellipsis, and leaves a short one alone', () => {
    const line = [piece('referee ', { bold: true }), piece('report')];
    expect(truncate(line, 20)).toBe(line);
    expect(text(truncate(line, 10))).toBe('referee r…');
    expect(lineWidth(truncate(line, 10))).toBe(10);
    // A wide character that won't fit is left out whole, and the line is still exactly as wide.
    const cut = truncate([piece('観測観測')], 6);
    expect(text(cut)).toBe('観測… ');
    expect(lineWidth(cut)).toBe(6);
  });

  it('fits a line to an exact width, filling with the background given', () => {
    const out = fit([piece('due', { fg: 'red' })], 8, 'grey');
    expect(lineWidth(out)).toBe(8);
    expect(out.every((p) => p.bg === 'grey')).toBe(true);
    expect(lineWidth(fit([piece('a much longer line than fits')], 8))).toBe(8);
  });

  it('puts the right side flush against the edge and cuts the left to keep a gap', () => {
    const line = spread([piece('Wednesday, October 28')], [piece('[ ‹ › ]')], 40);
    expect(lineWidth(line)).toBe(40);
    expect(text(line).endsWith('[ ‹ › ]')).toBe(true);
    const tight = spread([piece('Wednesday, October 28')], [piece('[ ‹ › ]')], 20);
    expect(lineWidth(tight)).toBe(20);
    expect(text(tight)).toMatch(/…\s{2}\[ ‹ › \]$/);
  });

  it('wraps between words, breaks a word too long for a line, and keeps each piece’s style', () => {
    const wrapped = wrap([piece('After the meeting, '), piece('rerun', { bold: true }), piece(' the fits.')], 12);
    expect(lines(wrapped)).toEqual(['After the', 'meeting,', 'rerun the', 'fits.']);
    expect(wrapped[2][0]).toMatchObject({ text: 'rerun', bold: true });
    expect(lines(wrap([piece('supercalifragilistic')], 8))).toEqual(['supercal', 'ifragili', 'stic']);
    expect(lines(wrap([piece('one\ntwo')], 20))).toEqual(['one', 'two']);
    for (const line of wrap([piece('観測 the 観測観測 night')], 6)) expect(lineWidth(line)).toBeLessThanOrEqual(6);
  });
});

describe('typing a line', () => {
  const type = (line, ...keys) => keys.reduce((l, [input, key = {}]) => editLine(l, input, key) ?? l, line);

  it('inserts at the cursor and moves it by characters, words and to either end', () => {
    let line = type(lineInput(''), ['submit'], [' '], ['abstract']);
    expect(inputText(line)).toBe('submit abstract');
    line = type(line, ['b', { meta: true }], ['the ']);
    expect(inputText(line)).toBe('submit the abstract');
    line = type(line, ['a', { ctrl: true }], ['x ']);
    expect(inputText(line)).toBe('x submit the abstract');
    line = type(line, ['e', { ctrl: true }], [' fri']);
    expect(inputText(line)).toBe('x submit the abstract fri');
    line = type(line, ['', { home: true }], ['', { delete: true }], ['', { delete: true }]);
    expect(inputText(line)).toBe('submit the abstract fri');
    line = type(line, ['f', { meta: true }], ['', { rightArrow: true }], ['', { leftArrow: true }]);
    expect(line.pos).toBe(6);
  });

  it('deletes back a character, a word, or to the start', () => {
    let line = lineInput('call the observatory');
    line = type(line, ['', { backspace: true }]);
    expect(inputText(line)).toBe('call the observator');
    line = type(line, ['w', { ctrl: true }]);
    expect(inputText(line)).toBe('call the ');
    line = type(line, ['u', { ctrl: true }]);
    expect(inputText(line)).toBe('');
  });

  it('treats an accented letter or a joined emoji as one character', () => {
    // The é as an e and a combining accent.
    let line = type(lineInput('café 👩‍🔬'), ['', { backspace: true }]);
    expect(inputText(line)).toBe('café ');
    line = type(line, ['', { leftArrow: true }], ['', { backspace: true }]);
    expect(inputText(line)).toBe('caf ');
  });

  it('leaves Enter, Esc, Tab and the arrows up and down to the app', () => {
    const line = lineInput('x');
    for (const key of [{ return: true }, { escape: true }, { tab: true }, { upArrow: true }, { downArrow: true }]) expect(editLine(line, '', key)).toBeNull();
    expect(editLine(line, '\x01', {})).toBeNull();
  });

  it('turns a pasted line break into a space', () => {
    expect(inputText(insertText(lineInput('a'), 'b\nc'))).toBe('ab c');
  });

  it('draws the line with the cursor in view, scrolled sideways when it’s long', () => {
    const long = lineInput('a task title much longer than the box it is typed into');
    const shown = inputPieces(long, 20, {});
    expect(lineWidth(shown)).toBeLessThanOrEqual(20);
    // The cursor, after the last character, is the last thing shown, inverted.
    expect(shown.at(-1)).toMatchObject({ text: ' ', inverse: true });
    expect(text(shown)).toContain('typed into');
    const empty = inputPieces(lineInput(''), 20, { placeholder: 'Search' });
    expect(text(empty)).toBe('Search');
    expect(empty[0]).toMatchObject({ text: 'S', inverse: true });
  });
});
