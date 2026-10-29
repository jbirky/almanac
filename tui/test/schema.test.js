// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { BODY_FIELD, labelKey } from '@almanac/shared';
import { appendBlocks, appendLines, element, firstTextblock, keepShape, newParagraph, unwrapBox } from '../src/journal/doc.js';
import * as edits from '../src/journal/edit.js';
import { blocks } from './helpers.js';

// The web editor's own modules, less the database worker they talk to, which a test has no use for.
vi.mock('../../client/src/lib/db.js', () => ({ action: {}, query: {}, onChange: () => () => {}, onStatus: () => () => {} }));
const { journalExtensions } = await import('../../client/src/components/editor/NoteEditor.jsx');

// What the terminal writes has to be what TipTap would: the browser loads a body through
// y-prosemirror and the journal editor's schema, and a shape the schema doesn't allow is dropped,
// or stops the day from showing at all. So each journal here is written with the terminal's
// editing, then opened in the web's own editor (its extensions, under jsdom), which has to show
// exactly what's in the document and change nothing in it.

const editors = [];
afterEach(() => {
  while (editors.length) editors.pop().destroy();
});

// A body as ProseMirror JSON, read straight from the Yjs document: what the editor should show.
function fromYjs(node) {
  if (node instanceof Y.XmlText) {
    return node.toDelta().map((op) => {
      const marks = Object.entries(op.attributes ?? {}).map(([type, attrs]) => ({ type, ...(attrs && Object.keys(attrs).length ? { attrs } : {}) }));
      return { type: 'text', text: op.insert, ...(marks.length ? { marks } : {}) };
    });
  }
  const content = node.toArray().flatMap(fromYjs);
  if (node instanceof Y.XmlElement) {
    const attrs = node.getAttributes();
    return [{ type: node.nodeName, ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) }];
  }
  return { type: 'doc', content };
}

// The same for what the editor holds: attributes left at null (y-prosemirror doesn't store them)
// left out, and runs of text in the same marks as one, as ProseMirror keeps them.
function normalized(json) {
  const out = { type: json.type };
  if (json.text !== undefined) out.text = json.text;
  const attrs = Object.fromEntries(Object.entries(json.attrs ?? {}).filter(([, v]) => v !== null));
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (json.marks?.length) out.marks = json.marks.map(normalized).sort((a, b) => a.type.localeCompare(b.type));
  const content = [];
  for (const child of (json.content ?? []).map(normalized)) {
    const last = content.at(-1);
    if (last?.type === 'text' && child.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(child.marks)) last.text += child.text;
    else content.push(child);
  }
  if (content.length) out.content = content;
  return out;
}

// Opens a body in the web's journal editor. Returns what it shows, and the updates it made to the
// document on the way (there should be none).
async function openInBrowser(state) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const updates = [];
  doc.on('update', (update) => updates.push(update));
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: journalExtensions({ doc, placeholder: 'Write', day: '2026-10-28', resolveLabel: () => null, onCreate: () => {} }),
  });
  editors.push(editor);
  // The binding draws the document a moment after the editor starts.
  await new Promise((resolve) => setTimeout(resolve, 20));
  editor.state.doc.check();
  return { shown: normalized(editor.getJSON()), expected: normalized(fromYjs(doc.getXmlFragment(BODY_FIELD))), updates };
}

async function expectLoadsAsWritten(doc) {
  const { shown, expected, updates } = await openInBrowser(Y.encodeStateAsUpdate(doc));
  expect(shown).toEqual(expected);
  expect(updates).toHaveLength(0);
  return shown;
}

// A journal written with the terminal's editing, as its keys do it. `at` is where writing is: a
// place in a textblock, or a task block whose title is being typed.
function journal(build, { boxOnly = false } = {}) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(BODY_FIELD);
  let n = 0;
  const tasks = [];
  const ctx = {
    boxOnly,
    newId: () => `id-${++n}`,
    resolveLabel: (name) => `label-${labelKey(name)}`,
    createTask: (id, title, label) => tasks.push({ id, title, label }),
  };
  let at = null;
  const edit = (fn) => {
    let result;
    doc.transact(() => {
      result = fn();
      keepShape(fragment);
    });
    if (result?.caret) at = result.caret;
    else if (result?.task) at = { task: result.task };
    return result;
  };
  const w = {
    doc,
    fragment,
    tasks,
    get at() {
      return at;
    },
    // The first key in an empty journal makes its first paragraph.
    begin: () => edit(() => ({ caret: { el: newParagraph(fragment, 0), offset: 0 } })),
    type: (text) => edit(() => edits.type(ctx, at, text)),
    paste: (text) => edit(() => edits.paste(ctx, at, text)),
    // Enter in a task's title adds the next task, as in the browser; on an empty one, makes it a
    // line again (its title is typed in the task, not in the document).
    enter: () => edit(() => (at.task ? { task: edits.taskAfter(ctx, at.task) } : edits.enter(ctx, at))),
    leaveTask: () => edit(() => ({ caret: { el: edits.paragraphFor(at.task), offset: 0 } })),
    backspace: () => edit(() => edits.backspace(ctx, at)),
    del: () => edit(() => edits.deleteAhead(ctx, at)),
    move: (dir) => edit(() => ({ caret: { el: edits.moveBlock(at.el ?? at.task, dir, ctx) ?? at.el ?? at.task, offset: at.offset ?? 0 } })),
    // Into the paragraph at `path` (indexes from the top), at `offset` (its end by default).
    to: (path, offset) => {
      const el = path.reduce((node, i) => node.toArray()[i], fragment);
      at = { el, offset: offset ?? edits.unitsOf(el).at(-1)?.to ?? 0 };
    },
    edit,
  };
  build(w);
  return w;
}

describe('what the terminal writes, opened in the web editor', () => {
  it('the example day from the e2e suite, typed in the terminal', async () => {
    const w = journal((j) => {
      j.begin();
      j.type('Discussed priors for the fits.');
      j.enter();
      j.type('[] ');
      j.enter();
      j.leaveTask();
      j.type('#meeting Group meeting with the TESS team');
      j.enter();
      j.type('Agreed to rerun the fits.');
      j.enter();
      j.type('[] Email the priors to the group');
      j.enter();
      j.leaveTask();
      // Enter on an empty last line leaves the box.
      j.enter();
      j.type('After the meeting.');
      j.enter();
      j.type('#Paper-notes Smith et al. 2024: TESS systematics');
      j.enter();
      j.enter();
      j.type('Below the boxes.');
    });
    const shown = await expectLoadsAsWritten(w.doc);
    expect(shown.content.map((b) => b.type)).toEqual(['paragraph', 'taskRef', 'noteBox', 'paragraph', 'noteBox', 'paragraph']);
    expect(shown.content[1].attrs).toEqual({ id: 'id-1' });
    expect(shown.content[2]).toMatchObject({ attrs: { id: 'id-3', label: 'label-meeting' } });
    expect(shown.content[2].content.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'taskRef']);
    expect(shown.content[4]).toMatchObject({ attrs: { label: 'label-papernotes' } });
    // Tasks written in a box are filed under its label.
    expect(w.tasks.map((t) => t.label)).toEqual([null, null, 'label-meeting', 'label-meeting']);
  });

  it('headings, lists, quotes, formulas and marks, from their input rules', async () => {
    const w = journal((j) => {
      j.begin();
      j.type('# Plan');
      j.enter();
      j.type('### Detail');
      j.enter();
      j.type('Some **bold**, *italic*, `code` and ~~struck~~ text, and $E = mc^2$ inline.');
      j.enter();
      j.type('- first point');
      j.enter();
      j.type('second point');
      j.enter();
      j.enter();
      j.type('3. third');
      j.enter();
      j.type('fourth');
      j.enter();
      j.enter();
      j.type('> a quote');
      j.enter();
      j.enter();
      j.type('$$\\int_0^1 x^2\\,dx$$');
      j.type('Prices such as $5 and $10 stay text.');
    });
    const shown = await expectLoadsAsWritten(w.doc);
    // The last line is the one the journal always ends with, after what was lifted out of the quote.
    expect(shown.content.map((b) => b.type)).toEqual(['heading', 'heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'blockMath', 'paragraph', 'paragraph']);
    expect(shown.content[1].attrs).toEqual({ level: 3 });
    expect(shown.content[2].content.filter((c) => c.marks).map((c) => [c.text, c.marks[0].type])).toEqual([
      ['bold', 'bold'],
      ['italic', 'italic'],
      ['code', 'code'],
      ['struck', 'strike'],
    ]);
    expect(shown.content[2].content.find((c) => c.type === 'inlineMath').attrs).toEqual({ latex: 'E = mc^2' });
    expect(shown.content[4].attrs).toEqual({ start: 3 });
    expect(shown.content[4].content).toHaveLength(2);
    expect(shown.content[6].attrs).toEqual({ latex: '\\int_0^1 x^2\\,dx' });
    expect(shown.content[7].content[0].text).toBe('Prices such as $5 and $10 stay text.');
  });

  it('blocks moved into, out of and past boxes, and boxes moved and unwrapped', async () => {
    const w = journal((j) => {
      j.begin();
      j.type('one');
      j.enter();
      j.type('#meeting in the box');
      j.enter();
      j.type('[] a task');
      j.enter();
      j.leaveTask();
      j.enter();
      j.type('two');
    });
    // "two" up into the box, then on up past its lines and out of its top; "one" down into it.
    w.move(-1);
    w.move(-1);
    w.move(-1);
    w.move(-1);
    w.to([0]);
    w.move(1);
    w.move(1);
    // The task block too, and the box itself down past the paragraph after it.
    const box = () => w.fragment.toArray().find((n) => n.nodeName === 'noteBox');
    const task = box().toArray().find((n) => n.nodeName === 'taskRef');
    w.edit(() => ({ caret: { el: edits.moveBlock(task, 1) ?? task, offset: 0 } }));
    w.edit(() => ({ caret: { el: edits.moveBlock(box(), 1), offset: 0 } }));
    const shown = await expectLoadsAsWritten(w.doc);
    expect(shown.content.map((b) => b.type)).toEqual(['paragraph', 'taskRef', 'noteBox', 'paragraph']);

    w.edit(() => ({ caret: { el: firstTextblock(w.fragment.toArray()[2]), offset: 0 } }));
    w.edit(() => edits.removeBlock(w.fragment.toArray()[0]));
    w.edit(() => unwrapBox(box()));
    await expectLoadsAsWritten(w.doc);
  });

  it('Backspace and Delete joining, lifting and taking out blocks', async () => {
    const w = journal((j) => {
      j.begin();
      j.type('## Heading');
      j.enter();
      j.type('after it');
      // At a paragraph's start, it joins the block before; at a heading's, the heading goes.
      j.to([1], 0);
      j.backspace();
      j.to([0], 0);
      j.backspace();
      j.to([0]);
      j.enter();
      j.type('- an item');
      j.enter();
      j.type('another');
      // At a list item's start, it leaves the list; at a quote's, the quote.
      j.to([1, 1, 0], 0);
      j.backspace();
      j.to([2]);
      j.enter();
      j.type('> quoted');
      j.to([3, 0], 0);
      j.backspace();
      // An empty box goes; a formula turns back into its text, and back.
      j.to([3]);
      j.enter();
      j.type('#meeting ');
      j.backspace();
      j.type('with $x$');
      j.backspace();
      j.type('y$');
      // Delete at a block's end joins the next one to it.
      j.to([0], 0);
      j.del();
      j.to([2]);
      j.del();
    });
    const shown = await expectLoadsAsWritten(w.doc);
    expect(shown.content.map((b) => b.type)).toEqual(['paragraph', 'bulletList', 'paragraph', 'paragraph']);
    expect(shown.content[0].content[0].text).toBe('eadingafter it');
    expect(shown.content[2].content[0].text).toBe('anotherquoted');
    expect(shown.content[3].content.at(-1)).toEqual({ type: 'inlineMath', attrs: { latex: 'xy' } });
  });

  it('pasted lines, a journal emptied out, and an empty one written in', async () => {
    const pasted = journal((j) => {
      j.begin();
      j.type('- item');
      j.paste('one\ntwo\nthree');
    });
    await expectLoadsAsWritten(pasted.doc);

    const emptied = journal((j) => {
      j.begin();
      j.type('gone');
      j.edit(() => edits.removeBlock(j.fragment.toArray()[0]));
    });
    const shown = await expectLoadsAsWritten(emptied.doc);
    expect(shown.content).toEqual([{ type: 'paragraph' }]);
  });

  it('`almanac log` at the end of a day written on the web', async () => {
    const doc = new Y.Doc();
    const body = doc.getXmlFragment(BODY_FIELD);
    blocks.para(body, 'Discussed ', { text: 'priors', marks: { italic: {} } }, '.');
    blocks.box(body, 'box-1', 'label-meeting', (box) => blocks.para(box, 'Group meeting'));
    blocks.element(body, 'paragraph');
    doc.transact(() => {
      appendLines(body, ['Asked about the new PSF.', '', 'And one more.']);
      keepShape(body);
    });
    const shown = await expectLoadsAsWritten(doc);
    expect(shown.content.slice(2).map((b) => b.content?.[0].text ?? '')).toEqual(['Asked about the new PSF.', '', 'And one more.']);
  });

  it('images attached at the end of a day, as `almanac attach` puts them', async () => {
    const w = journal((j) => {
      j.begin();
      j.type('A plot:');
      j.edit(() => appendBlocks(j.fragment, [element('image', { file: 'file-1', alt: 'light curve', width: 320, height: 200 })]));
      j.edit(() => appendBlocks(j.fragment, [element('image', { file: 'file-2', alt: '', width: 2400, height: 1600 })]));
    });
    const shown = await expectLoadsAsWritten(w.doc);
    expect(shown.content.map((b) => b.type)).toEqual(['paragraph', 'image', 'image', 'paragraph']);
    expect(shown.content[1].attrs).toEqual({ file: 'file-1', alt: 'light curve', width: 320, height: 200 });
  });

  it('writing in a box shown away from its day (pinned, or by label), which stays in the box', async () => {
    const day = journal((j) => {
      j.begin();
      j.type('#meeting first line');
    });
    const box = day.fragment.toArray()[0];
    const w = journal(() => {}, { boxOnly: true });
    Y.applyUpdate(w.doc, Y.encodeStateAsUpdate(day.doc));
    w.to([0, 0]);
    w.enter();
    w.enter();
    w.type('[] a task in it');
    w.enter();
    w.leaveTask();
    w.type('last');
    w.move(1);
    w.to([0, 0]);
    w.move(-1);
    const shown = await expectLoadsAsWritten(w.doc);
    expect(shown.content.map((b) => b.type)).toEqual(['noteBox', 'paragraph']);
    expect(shown.content[0].content.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'taskRef', 'paragraph']);
    expect(box.nodeName).toBe('noteBox');
  });

  it('notices a body the browser would rewrite', async () => {
    // A box in a box: the schema doesn't allow it, so the day wouldn't show.
    const doc = new Y.Doc();
    const body = doc.getXmlFragment(BODY_FIELD);
    blocks.para(body, 'hello');
    blocks.box(body, 'outer', null, (outer) => blocks.box(outer, 'inner', null, (inner) => blocks.para(inner, 'x')));
    const bad = await openInBrowser(Y.encodeStateAsUpdate(doc));
    expect(bad.shown).not.toEqual(bad.expected);
    // A day ending in a box: the browser shows a line after it, and writes it with its first edit.
    const ending = new Y.Doc();
    blocks.box(ending.getXmlFragment(BODY_FIELD), 'box', null, (box) => blocks.para(box, 'notes'));
    const shown = await openInBrowser(Y.encodeStateAsUpdate(ending));
    expect(shown.shown.content.map((b) => b.type)).toEqual(['noteBox', 'paragraph']);
    expect(shown.expected.content.map((b) => b.type)).toEqual(['noteBox']);
  });
});
