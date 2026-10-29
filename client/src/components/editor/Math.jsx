import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { InputRule } from '@tiptap/core';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

// What KaTeX can't read shows as an error in place, not a crash. KaTeX's defaults leave out
// links and raw HTML, so a formula can't inject anything into the page.
const KATEX = { throwOnError: false, errorColor: 'var(--late)' };

// "Edit the formula at this position": Enter on a selected formula, for its view to open.
const editAt = new EventTarget();

// Equations, written as in LaTeX: $x^2$ in a line of text, or $$...$$ on a line of its own for
// one set apart. They keep the official extension's nodes (inlineMath and blockMath, with the
// source in `latex`); the syntax and the editing are ours.
export const InlineEquation = InlineMath.extend({
  addInputRules() {
    return [
      // A closing $ after "$...": not "$$", not "\$", and nothing starting or ending with a
      // space, so prices such as "$5 and $10" stay text. Backspace right after turns it back.
      new InputRule({
        find: /(?<![\\$])\$([^\s$](?:[^$]*[^\s$\\])?)\$$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1] }));
        },
      }),
    ];
  },
  renderText: ({ node }) => `$${node.attrs.latex}$`,
  addKeyboardShortcuts() {
    return { Enter: editSelected(this.type) };
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },
});

export const BlockEquation = BlockMath.extend({
  addInputRules() {
    return [
      // A line that is nothing but $$...$$ becomes the equation, with a new line after it.
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          const wholeLine = range.from === $from.start() && range.to === $from.end();
          const parent = $from.depth > 0 ? $from.node(-1) : null;
          if (!wholeLine || !parent?.canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type)) return null;
          const { tr } = state;
          const equation = this.type.create({ latex: match[1].trim() });
          tr.replaceWith($from.before(), $from.after(), [equation, state.schema.nodes.paragraph.create()]);
          tr.setSelection(Selection.near(tr.doc.resolve($from.before() + equation.nodeSize + 1)));
        },
      }),
    ];
  },
  renderText: ({ node }) => `$$${node.attrs.latex}$$`,
  addKeyboardShortcuts() {
    return { Enter: editSelected(this.type) };
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },
});

// Enter on a selected formula opens it for editing.
const editSelected =
  (type) =>
  ({ editor }) => {
    const { selection } = editor.state;
    if (!(selection instanceof NodeSelection) || selection.node.type !== type) return false;
    editAt.dispatchEvent(new CustomEvent('edit', { detail: selection.from }));
    return true;
  };

// A formula, rendered. A click (or Enter when it's selected) shows its LaTeX to edit, with the
// formula updating as you type; Enter or a click elsewhere keeps it, Escape puts it back, and
// an empty one is removed.
function MathView({ node, editor, getPos, updateAttributes, deleteNode, selected }) {
  const display = node.type.name === 'blockMath';
  const [draft, setDraft] = useState(null);
  // Set while the source is open: finishing once (Enter, then the blur as focus moves back to
  // the text) mustn't save or delete twice.
  const editing = useRef(false);
  const inputRef = useRef(null);
  const latex = draft ?? node.attrs.latex;
  const html = useMemo(() => katex.renderToString(latex || '\\square', { ...KATEX, displayMode: display }), [latex, display]);

  const open = () => {
    if (!editor.isEditable || editing.current) return;
    editing.current = true;
    setDraft(node.attrs.latex);
  };

  useEffect(() => {
    const onEdit = (e) => e.detail === getPos() && open();
    editAt.addEventListener('edit', onEdit);
    return () => editAt.removeEventListener('edit', onEdit);
  });

  useEffect(() => {
    if (draft !== null) inputRef.current?.focus();
  }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep or drop the change; `back` returns the cursor to the text just after the formula.
  const finish = (keep, back) => {
    if (!editing.current) return;
    editing.current = false;
    const next = draft?.trim() ?? '';
    setDraft(null);
    if (keep && !next) {
      deleteNode();
      if (back) editor.commands.focus();
      return;
    }
    if (keep && next !== node.attrs.latex) updateAttributes({ latex: next });
    if (back) {
      editor
        .chain()
        .command(({ tr }) => {
          tr.setSelection(Selection.near(tr.doc.resolve(getPos() + node.nodeSize), 1));
          return true;
        })
        .focus()
        .run();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false, true);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true, true);
    }
  };

  const Field = display ? 'textarea' : 'input';
  return (
    // Inline formulas sit in a line of text, so their wrapper is a span.
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      className={`math ${display ? 'math-block' : 'math-inline'}${selected ? ' selected' : ''}${draft !== null ? ' editing' : ''}`}
    >
      <span
        className="math-render"
        onClick={open}
        title={draft === null ? `${node.attrs.latex}\nClick to edit` : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {draft !== null && (
        <span className="math-editor" contentEditable={false}>
          <Field
            ref={inputRef}
            className="math-source"
            value={draft}
            rows={display ? Math.min(6, draft.split('\n').length) : undefined}
            spellCheck={false}
            aria-label={display ? 'Equation in LaTeX' : 'Formula in LaTeX'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => finish(true, false)}
          />
          <span className="math-hint">{display ? 'Enter to finish, Shift+Enter for a new line' : 'Enter to finish'} · Esc to undo</span>
        </span>
      )}
    </NodeViewWrapper>
  );
}
