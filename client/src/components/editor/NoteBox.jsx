import { useEffect, useId, useRef, useState } from 'react';
import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, Selection, TextSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { LABEL_COLORS, NOTE_BOX, labelId, labelKey, newId } from '@almanac/shared';
import { action } from '../../lib/db.js';
import { colorProps, readableShades } from '../../lib/color.js';
import { isDark } from '../../lib/settings.js';
import { navigate, useDebounced, useQuery } from '../../lib/hooks.js';
import { GripIcon, PinIcon } from '../icons.jsx';

// Boxes added in this tab whose label picker opens as soon as they show.
const pickOnShow = new Set();

// The box being dragged by its grip, from the start of the drag until it's let go: its editor,
// the box itself and where it was.
let boxDrag = null;

// Moves a dragged box to where it was let go. The box is found as itself (where it was, or by
// its id if the journal changed meanwhile), never as "the selection": ProseMirror's own drop
// deletes whatever is selected when the drop lands if the drag began inside the selection (as
// it does for a box just dropped, which stays selected), so a selection that moved on the way
// left the box where it was and dropped a copy.
function moveBox(view, drag, event) {
  const { doc } = view.state;
  let from = doc.nodeAt(drag.pos) === drag.node ? drag.pos : null;
  if (from === null && drag.node.attrs.id) {
    doc.forEach((child, offset) => {
      if (from === null && child.type.name === NOTE_BOX && child.attrs.id === drag.node.attrs.id) from = offset;
    });
  }
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (from === null || !at) return;
  const box = doc.nodeAt(from);
  const to = dropPoint(doc, at.pos, new Slice(Fragment.from(box), 0, 0));
  // Let go next to where it was: nothing to do.
  if (to === null || (to >= from && to <= from + box.nodeSize)) return;
  const tr = view.state.tr.delete(from, from + box.nodeSize);
  const pos = tr.mapping.map(to);
  tr.insert(pos, box);
  // The cursor goes into the box, rather than the box being selected, where a stray key would
  // delete it.
  tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

const sameLabel = (a, b) => {
  const key = labelKey(a);
  return key ? key === labelKey(b) : a.trim().toLowerCase() === b.trim().toLowerCase();
};

// The label a typed name refers to: an existing one whatever its case or spacing, else a new
// one, created here. Blank means none.
export function resolveLabel(text, labels = []) {
  const name = text.trim();
  if (!name) return null;
  const existing = labels.find((l) => sameLabel(l.name, name));
  if (existing) return existing.id;
  // A label renamed since it was made still holds the id its old name gave it.
  const id = labels.some((l) => l.id === labelId(name)) ? newId() : labelId(name);
  action.createLabel({ id, name });
  return id;
}

// Adds an empty notes box at the end of the journal and opens its label picker.
export function addNoteBox(editor) {
  const id = newId();
  pickOnShow.add(id);
  editor.chain().appendNoteBox({ id }).run();
}

// A notes box: one part of a day's journal, such as a meeting's or a lecture's notes, under a
// colored label. It holds any blocks except another box, so boxes sit only at the top level
// (the journal's document allows them there). The box stores its label's id; the name and
// color live with the label, so renaming or recoloring one shows on every box at once. It moves,
// notes and all, by the grip in the margin beside its label.
export const NoteBox = Node.create({
  name: NOTE_BOX,
  group: NOTE_BOX,
  content: 'block+',
  defining: true,
  isolating: true,
  draggable: true,
  // Its Enter and Backspace run before the editor's own.
  priority: 200,

  addOptions() {
    // resolveLabel turns a typed label name into a label id, creating the label if it's new.
    // `day` is the journal's date, which a box is pinned from.
    return { resolveLabel: () => null, day: null };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-box-id'),
        renderHTML: (attrs) => ({ 'data-box-id': attrs.id }),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-note-box]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-note-box': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteBoxView, {
      stopEvent: ({ event }) => {
        const target = event.target instanceof Element ? event.target : null;
        // The box's notes are the editor's.
        if (!target || target.closest('.note-box-body')) return false;
        // The box moves only by its grip: a drag started on its label or border is cancelled,
        // so one meant to select text from there doesn't carry the box off.
        if (event.type === 'dragstart' && !target.closest('[data-drag-handle]')) {
          event.preventDefault();
          return true;
        }
        // The label chip and its picker handle their own events, except a drop onto them.
        const dragEvent = event.type.startsWith('drag') || event.type === 'drop';
        return !dragEvent && target.closest('.note-box-header') !== null;
      },
    });
  },

  // A box dragged by its grip always moves, by moveBox, never by the editor's own drop. A copy
  // (dragging with Ctrl or Alt) or a drop from elsewhere would make a second box with the same
  // id, and the tasks in it would be in two places.
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      new Plugin({
        view: (view) => {
          // A drop the editor didn't take (let go where it can't place anything, or on
          // something that handles its own events) still moves the box if it can, and is
          // cancelled either way, so the browser doesn't drop the box's text there itself.
          const onDrop = (event) => {
            const drag = boxDrag;
            if (drag?.view !== view) return;
            boxDrag = null;
            event.preventDefault();
            view.dragging = null;
            moveBox(view, drag, event);
          };
          // A drag let go outside the window, or called off with Escape.
          const onDragEnd = () => {
            if (boxDrag?.view === view) boxDrag = null;
          };
          addEventListener('drop', onDrop);
          addEventListener('dragend', onDragEnd, true);
          return {
            destroy() {
              removeEventListener('drop', onDrop);
              removeEventListener('dragend', onDragEnd, true);
            },
          };
        },
        props: {
          handleDrop: (view, event, slice, moved) => {
            if (boxDrag?.view === view) {
              const drag = boxDrag;
              boxDrag = null;
              moveBox(view, drag, event);
              return true;
            }
            if (moved) return false;
            let hasBox = false;
            slice.content.descendants((node) => {
              if (node.type.name === name) hasBox = true;
            });
            return hasBox;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      // Puts an empty box at the end of the document, in place of an empty last line.
      appendNoteBox:
        (attrs) =>
        ({ state, commands }) => {
          const { doc } = state;
          const last = doc.lastChild;
          const from = last?.type.name === 'paragraph' && !last.content.size ? doc.content.size - last.nodeSize : doc.content.size;
          return commands.insertContentAt(
            { from, to: doc.content.size },
            { type: this.name, attrs, content: [{ type: 'paragraph' }] },
          );
        },
    };
  },

  addKeyboardShortcuts() {
    // Where the cursor is, if it's on an empty line directly inside a box.
    const emptyLineInBox = ({ selection }) => {
      const { $from, empty } = selection;
      if (!empty || $from.depth !== 2 || $from.node(1).type.name !== this.name) return null;
      if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size) return null;
      return { box: $from.node(1), index: $from.index(1), boxPos: $from.before(1) };
    };
    return {
      // Enter on an empty last line leaves the box.
      Enter: ({ editor }) => {
        const at = emptyLineInBox(editor.state);
        if (!at || at.box.childCount < 2 || at.index !== at.box.childCount - 1) return false;
        return editor
          .chain()
          .command(({ tr }) => {
            const boxEnd = at.boxPos + at.box.nodeSize;
            tr.delete(boxEnd - 1 - at.box.lastChild.nodeSize, boxEnd - 1);
            const after = tr.mapping.map(boxEnd);
            const next = tr.doc.nodeAt(after);
            if (!(next?.type.name === 'paragraph' && !next.content.size)) {
              tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
            }
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            return true;
          })
          .run();
      },
      // Backspace in an empty box removes it, unless it undoes the "#label " that made it.
      Backspace: ({ editor }) => {
        const at = emptyLineInBox(editor.state);
        if (!at || at.box.childCount !== 1) return false;
        if (editor.commands.undoInputRule()) return true;
        return editor
          .chain()
          .command(({ tr }) => {
            // Leave an empty line where the box was, unless one already follows it.
            const boxEnd = at.boxPos + at.box.nodeSize;
            const next = tr.doc.nodeAt(boxEnd);
            if (next?.type.name === 'paragraph' && !next.content.size) tr.delete(at.boxPos, boxEnd);
            else tr.replaceWith(at.boxPos, boxEnd, tr.doc.type.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, at.boxPos + 1));
            return true;
          })
          .run();
      },
    };
  },

  // "#meeting " at the start of a top-level paragraph turns it into a box labeled "meeting"
  // (an existing label whatever its case, else a new one); the rest of the line goes in the box.
  addInputRules() {
    return [
      new InputRule({
        find: /^#(\p{L}[\p{L}\p{N}_-]*)\s$/u,
        handler: ({ state, range, match }) => {
          const $start = state.doc.resolve(range.from);
          if ($start.depth !== 1 || $start.parent.type.name !== 'paragraph') return null;
          const label = this.options.resolveLabel(match[1].replace(/[-_]+/g, ' '));
          const rest = $start.parent.content.cut(range.to - $start.start());
          const { tr } = state;
          const box = this.type.create({ id: newId(), label }, state.schema.nodes.paragraph.create(null, rest));
          tr.replaceWith($start.before(), $start.after(), box);
          tr.setSelection(TextSelection.create(tr.doc, $start.before() + 2));
        },
      }),
    ];
  },
});

function NoteBoxView({ node, editor, getPos, updateAttributes, extension }) {
  const labels = useQuery('labels');
  const label = labels?.find((l) => l.id === node.attrs.label) ?? null;
  const { day } = extension.options;
  const pinned = useQuery('pinnedFrom', [day])?.includes(node.attrs.id) ?? false;
  const [picking, setPicking] = useState(() => pickOnShow.has(node.attrs.id));
  const header = useRef(null);

  useEffect(() => {
    pickOnShow.delete(node.attrs.id);
  }, [node.attrs.id]);

  // A click anywhere else closes the picker.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e) => header.current?.contains(e.target) || setPicking(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [picking]);

  // Put the cursor at the start of the box's notes.
  const focusNotes = () =>
    editor
      .chain()
      .command(({ tr }) => {
        tr.setSelection(Selection.near(tr.doc.resolve(getPos() + 1), 1));
        return true;
      })
      .focus()
      .run();

  const close = () => {
    setPicking(false);
    focusNotes();
  };

  // Pin the box to the days after this one, or unpin it from all of them. A box from before
  // boxes had ids gets one first.
  const togglePin = () => {
    let id = node.attrs.id;
    if (!id) {
      id = newId();
      updateAttributes({ id });
    }
    if (pinned) action.unpinBox(day, id, day);
    else action.pinBox(day, id);
    close();
  };

  // Take the box away and leave its notes in the journal.
  const unwrap = () => {
    setPicking(false);
    const pos = getPos();
    editor
      .chain()
      .command(({ tr }) => {
        tr.replaceWith(pos, pos + node.nodeSize, node.content);
        tr.setSelection(Selection.near(tr.doc.resolve(pos + 1), 1));
        return true;
      })
      .focus()
      .run();
  };

  return (
    <NodeViewWrapper className={`note-box${label ? '' : ' unlabeled'}`} {...colorProps(label?.color)}>
      {/* The box is dragged by this; moveBox moves it where it's let go. */}
      <span
        className="drag-handle box-grip"
        contentEditable={false}
        draggable="true"
        data-drag-handle=""
        title="Drag to move"
        aria-hidden="true"
        onDragStart={() => {
          boxDrag = { view: editor.view, node, pos: getPos() };
        }}
      >
        <GripIcon />
      </span>
      <div className="note-box-header" contentEditable={false} ref={header}>
        <button
          className={`label-chip${label ? '' : ' empty'}`}
          onClick={() => setPicking(!picking)}
          aria-haspopup="dialog"
          aria-expanded={picking}
          aria-label={label ? `Label ${label.name}. Change label` : 'Add a label'}
        >
          {label && <span className="label-dot" aria-hidden="true" />}
          {label?.name ?? (labels ? 'Add label' : '')}
        </button>
        {pinned && (
          <span className="pin-mark" role="img" aria-label="Pinned to the days after this one" title="Pinned to the days after this one">
            <PinIcon />
          </span>
        )}
        {picking && (
          <LabelPicker
            labels={labels ?? []}
            current={label}
            onPick={(id) => {
              updateAttributes({ label: id });
              close();
            }}
            onClose={close}
            onUnwrap={unwrap}
            pinned={pinned}
            onPin={day ? togglePin : null}
          />
        )}
      </div>
      <NodeViewContent className="note-box-body" />
    </NodeViewWrapper>
  );
}

// The popover under a box's label chip: type to find a label or make a new one, then Enter or
// a click puts it on the box. "Edit" changes the current label's name and color everywhere.
function LabelPicker({ labels, current, onPick, onClose, onUnwrap, pinned, onPin }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const listId = useId();

  if (editing && current) {
    return (
      <div className="label-picker" role="dialog" aria-label={`Edit label ${current.name}`}>
        <LabelEditor label={current} labels={labels} onDone={() => setEditing(false)} onDeleted={onClose} />
      </div>
    );
  }

  const query = text.trim();
  const shown = query ? labels.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()) || sameLabel(l.name, query)) : labels;
  const options = shown.map((l) => ({ id: l.id, label: l }));
  if (query && !labels.some((l) => sameLabel(l.name, query))) options.push({ id: 'new', create: query });
  const choose = (option) => option && onPick(option.label ? option.label.id : resolveLabel(option.create, labels));

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="label-picker" role="dialog" aria-label="Label">
      <input
        className="label-search"
        value={text}
        autoFocus
        placeholder={labels.length ? 'Find or create a label' : 'Name a label, e.g. Meeting'}
        aria-label="Find or create a label"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${options[active].id}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {options.length > 0 && (
        <ul className="label-options" role="listbox" id={listId} aria-label="Labels">
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              {...colorProps(o.label?.color)}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              {o.label ? (
                <>
                  <span className="label-dot" aria-hidden="true" />
                  <span className="label-option-name">{o.label.name}</span>
                  {o.label.id === current?.id && <span className="label-current">✓</span>}
                </>
              ) : (
                <span className="label-create">Create “{o.create}”</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="label-picker-actions">
        {current && (
          <button onClick={() => navigate(`/label/${encodeURIComponent(current.id)}`)}>
            All “{current.name}” notes, by day
          </button>
        )}
        {current && <button onClick={() => setEditing(true)}>Rename or recolor “{current.name}”</button>}
        {onPin && <button onClick={onPin}>{pinned ? 'Unpin from the days after this one' : 'Pin to the days after this one'}</button>}
        {current && <button onClick={() => onPick(null)}>Remove label</button>}
        <button onClick={onUnwrap}>Remove box, keep notes</button>
      </div>
    </div>
  );
}

const colorName = (c) => c[0].toUpperCase() + c.slice(1);

// A palette color's shade in the current mode, as "#rrggbb", for the color picker to start
// from. The stylesheet gives each color as a light and dark pair, so ask the browser which
// one it shows.
const paletteHex = (name) => {
  const probe = document.createElement('span');
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g).map(Number);
  probe.remove();
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

// A label's name and color, changed for every box that has it, and deleting it. The color is
// one of the palette's, or any color from the picker after them.
export function LabelEditor({ label, labels, onDone, onDeleted, doneText = '‹ Labels' }) {
  const [name, setName] = useState(label.name);
  const [confirming, setConfirming] = useState(false);
  // A color being dragged around the picker, shown here at once and saved after a pause.
  const [draft, setDraft] = useState(null);
  const saveColor = useDebounced((color) => action.setLabelColor(label.id, color), 300);
  const color = draft ?? label.color;
  const picked = color.startsWith('#') ? color : null;
  const clash = name.trim() !== '' && labels.some((l) => l.id !== label.id && sameLabel(l.name, name));

  // Drop the draft once the saved color catches up with it: compared with the draft as it is
  // then, since the picker may have moved on since this render.
  useEffect(() => {
    setDraft((d) => (d === label.color ? null : d));
  }, [label.color, draft]);

  const pickColor = (next, now) => {
    setDraft(next);
    saveColor(next);
    if (now) saveColor.flush();
  };

  // When labels show a picked color in another shade in this mode, say so.
  const dark = isDark();
  const shown = picked && readableShades(picked)[dark ? 'dark' : 'light'];
  const note =
    shown && shown !== picked
      ? `In ${dark ? 'dark' : 'light'} mode, labels show a ${dark ? 'lighter' : 'darker'} shade of this color so their text stays readable.`
      : null;

  const saveName = () => {
    const next = name.trim();
    if (!next || clash) setName(label.name);
    else if (next !== label.name) action.updateItem(label.id, { title: next });
  };

  return (
    <div className="label-editor" {...colorProps(color)}>
      <button
        className="label-back"
        onClick={() => {
          saveName();
          saveColor.flush();
          onDone();
        }}
      >
        {doneText}
      </button>
      <input
        className="label-name"
        value={name}
        autoFocus
        aria-label="Label name"
        aria-invalid={clash || undefined}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !clash) {
            e.preventDefault();
            saveName();
            onDone();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setName(label.name);
            onDone();
          }
        }}
      />
      {clash && <p className="label-error">Another label has that name.</p>}
      <div className="label-colors">
        <div className="label-swatches" role="radiogroup" aria-label="Color">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={color === c}
              aria-label={colorName(c)}
              title={colorName(c)}
              data-color={c}
              className="swatch"
              onClick={() => pickColor(c, true)}
            />
          ))}
        </div>
        <label className={`swatch any-color${picked ? ' picked' : ''}`} title="Any color" style={picked ? { background: picked } : undefined}>
          <input
            type="color"
            value={picked ?? paletteHex(color)}
            aria-label="Any color"
            onChange={(e) => pickColor(e.target.value.toLowerCase())}
            onBlur={() => saveColor.flush()}
          />
        </label>
      </div>
      {note && <p className="label-note">{note}</p>}
      {confirming ? (
        <div className="label-delete">
          <p>
            {label.days
              ? `Boxes on ${label.days} ${label.days === 1 ? 'day' : 'days'} lose this label. Their notes stay.`
              : 'No boxes have this label.'}
          </p>
          <button
            className="danger"
            onClick={() => {
              action.deleteItem(label.id);
              onDeleted();
            }}
          >
            Delete label
          </button>
          <button onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button className="label-delete-start" onClick={() => setConfirming(true)}>
          Delete label…
        </button>
      )}
    </div>
  );
}
