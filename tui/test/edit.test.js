import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BODY_FIELD } from '@almanac/shared';
import { caretFromRel, caretToRel } from '../src/journal/caret.js';
import { keepShape, newParagraph, textLength } from '../src/journal/doc.js';
import * as edits from '../src/journal/edit.js';
import { layoutText } from '../src/journal/layout.js';
import { blocks } from './helpers.js';

// A journal to edit, its first line holding `text`, and a cursor to type with.
function line(text = '') {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(BODY_FIELD);
  const tasks = [];
  const ctx = { newId: () => `id-${tasks.length + 1}`, resolveLabel: (name) => `label-${name}`, createTask: (id, title, label) => tasks.push({ id, title, label }) };
  let at = null;
  doc.transact(() => {
    const p = newParagraph(fragment, 0);
    if (text) edits.paste(ctx, { el: p, offset: 0 }, text);
    at = { el: p, offset: textLength(p) };
  });
  const run = (fn) => {
    let result;
    doc.transact(() => {
      result = fn(at);
      keepShape(fragment);
    });
    if (result?.caret) at = result.caret;
    return result;
  };
  return { doc, fragment, tasks, ctx, run, get at() { return at; }, xml: () => fragment.toString() };
}

describe('typing in the journal', () => {
  it('takes formatting from the character before, and leaves it after a mark rule', () => {
    const j = line('a ');
    j.run((at) => edits.type(j.ctx, at, '**bold** and'));
    expect(j.xml()).toBe('<paragraph>a <bold>bold</bold> and</paragraph>');
    j.run((at) => edits.type(j.ctx, { el: at.el, offset: 6 }, 'er'));
    expect(j.xml()).toBe('<paragraph>a <bold>bolder</bold> and</paragraph>');
  });

  it('keeps prices as text, and runs no rules in code', () => {
    const j = line();
    j.run((at) => edits.type(j.ctx, at, 'costs $5 and $10.'));
    expect(j.xml()).toBe('<paragraph>costs $5 and $10.</paragraph>');
    const k = line();
    k.run((at) => edits.type(k.ctx, at, 'run `ab` now'));
    k.run((at) => edits.type(k.ctx, { el: at.el, offset: 5 }, ' $x$ **y** '));
    expect(k.xml()).toBe('<paragraph>run <code>a $x$ **y** b</code> now</paragraph>');
  });

  it('runs block rules only at the start of a line, and "#label " only at the top', () => {
    const j = line('text ');
    j.run((at) => edits.type(j.ctx, at, '# [] #x '));
    expect(j.xml()).toBe('<paragraph>text # [] #x </paragraph>');
    const k = line();
    k.run((at) => edits.type(k.ctx, at, '> #meeting '));
    expect(k.xml()).toBe('<blockquote><paragraph>#meeting </paragraph></blockquote><paragraph></paragraph>');
  });

  it('turns "[] " into a task, titled with the rest of the line, and says what\'s left to type', () => {
    const j = line('call the observatory');
    const result = j.run((at) => edits.type(j.ctx, { el: at.el, offset: 0 }, '[] '));
    expect(result.task.getAttribute('id')).toBe('id-1');
    expect(j.tasks).toEqual([{ id: 'id-1', title: 'call the observatory', label: null }]);
    expect(j.xml()).toBe('<taskref id="id-1"></taskref><paragraph></paragraph>');
    const k = line();
    expect(k.run((at) => edits.type(k.ctx, at, '[] send slides')).rest).toBe('send slides');
  });

  it('steps over characters and formulas whole, and by words', () => {
    const j = line('a👍🏽b ');
    j.run((at) => edits.type(j.ctx, at, '$x$ end'));
    const { el } = j.at;
    expect(edits.unitsOf(el).map((u) => u.text)).toEqual(['a', '👍🏽', 'b', ' ', '￼', ' ', 'e', 'n', 'd']);
    expect(edits.stepBack(el, 5)).toBe(1);
    expect(edits.stepAhead(el, 1)).toBe(5);
    expect(edits.stepAhead(el, 7)).toBe(8);
    expect(edits.wordBack(el, textLength(el))).toBe(textLength(el) - 3);
    expect(edits.wordAhead(el, 0)).toBe(1);
  });
});

describe('the cursor while writing', () => {
  it('keeps to its character as text is added before it, and goes when its block does', () => {
    const j = line('hello world');
    const rel = caretToRel({ el: j.at.el, offset: 6 });
    j.run((at) => edits.type(j.ctx, { el: at.el, offset: 0 }, 'oh, '));
    expect(caretFromRel(j.doc, rel).offset).toBe(10);
    // At the end of a line, text added there by another device goes after it.
    const end = caretToRel({ el: j.at.el, offset: textLength(j.at.el) });
    j.doc.transact(() => j.at.el.toArray()[0].insert(textLength(j.at.el), '!'));
    expect(caretFromRel(j.doc, end).offset).toBe(textLength(j.at.el) - 1);
    j.run((at) => edits.removeBlock(at.el));
    expect(caretFromRel(j.doc, rel)).toBeNull();
  });

  it('can sit in an empty paragraph, and beside a formula with no text after it', () => {
    const doc = new Y.Doc();
    const body = doc.getXmlFragment(BODY_FIELD);
    const empty = blocks.para(body);
    const math = blocks.para(body, 'x ', { math: 'y' });
    expect(caretFromRel(doc, caretToRel({ el: empty, offset: 0 }))).toEqual({ el: empty, offset: 0 });
    expect(caretFromRel(doc, caretToRel({ el: math, offset: 3 }))).toEqual({ el: math, offset: 3 });
  });
});

describe('laying out a line of text', () => {
  const parts = (text) => [{ text, style: {}, from: 0 }];
  const shown = (lines) => lines.map((l) => l.pieces.map((p) => (p.inverse ? `[${p.text}]` : p.text)).join(''));

  it('wraps between words, keeping where each place is', () => {
    const lines = layoutText(parts('the quick brown fox'), 10);
    expect(shown(lines)).toEqual(['the quick ', 'brown fox']);
    expect(lines.map((l) => [l.from, l.to])).toEqual([
      [0, 10],
      [10, 19],
    ]);
    // The end of the first line is the start of the next; the block's end is a place of its own.
    expect(lines[0].cols.at(-1)).toEqual([9, 9]);
    expect(lines[1].cols.at(-1)).toEqual([19, 9]);
  });

  it('draws the cursor on its character, or after the end, and on the next line at a wrap', () => {
    expect(shown(layoutText(parts('ab cd'), 10, 1))).toEqual(['a[b] cd']);
    expect(shown(layoutText(parts('ab cd'), 10, 5))).toEqual(['ab cd[ ]']);
    expect(shown(layoutText(parts('the quick brown'), 10, 10))).toEqual(['the quick ', '[b]rown']);
    expect(shown(layoutText([], 10, 0))).toEqual(['[ ]']);
  });

  it('breaks a word too long for a line, keeps a formula whole, and breaks at new lines', () => {
    expect(shown(layoutText(parts('abcdefghij'), 4))).toEqual(['abcd', 'efgh', 'ij']);
    const withMath = [
      { text: 'see ', style: {}, from: 0 },
      { text: '$x^2$', style: {}, from: 4, atom: true },
      { text: ' ok', style: {}, from: 5 },
    ];
    expect(shown(layoutText(withMath, 20, 4))).toEqual(['see [$x^2$] ok']);
    const code = layoutText(parts('one\ntwo'), 20, 3);
    expect(shown(code)).toEqual(['one[ ]', 'two']);
    expect(code[1].from).toBe(4);
  });
});
