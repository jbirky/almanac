import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Plugin, Selection } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { NOTE_BOX, newId } from '@almanac/shared';
import { action } from '../../lib/db.js';
import { useDebounced, useQuery, useToday } from '../../lib/hooks.js';
import { CategoryChip, DateChip } from '../TaskRow.jsx';
import { GripIcon, TrashIcon } from '../icons.jsx';
import { SubtaskChip, SubtaskList, useSubtasksOpen } from '../Subtasks.jsx';

// Task blocks created in this tab whose title box should take focus once the task loads.
const justCreated = new Set();
// Task blocks just moved with the keyboard whose view the editor made anew, so the new title
// box takes the focus.
const justMoved = new Set();

// The label of the notes box a position is in, or null: the box around it in a day's journal,
// or the document itself in a box's own editor (on a label's page), which is named as a box.
function boxLabel($pos) {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    if ($pos.node(depth).type.name === NOTE_BOX) return $pos.node(depth).attrs.label ?? null;
  }
  return null;
}

// A task inside a note. The block stores only the task's id; the title, status, category and
// due date live with the task, so checking it off here or in any list is the same change.
// `day` is the date the note is about: a task due that day doesn't show its date until hovered.
export const TaskBlock = Node.create({
  name: 'taskRef',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { onCreate: () => {}, day: null };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-task-id'),
        renderHTML: (attrs) => ({ 'data-task-id': attrs.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-task-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'task' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskBlockView, {
      // The checkbox, title box and links handle their own events.
      // Something being dragged in the editor (a task, a box) is the editor's to drop, even onto
      // a title box, which would otherwise take its text.
      stopEvent: ({ event }) => {
        if (this.editor.view.dragging && /^(dragenter|dragover|dragleave|drop)$/.test(event.type)) return false;
        return event.target instanceof Element && event.target.closest('input, button, a') !== null;
      },
      ignoreMutation: () => true,
    });
  },

  // A block dragged within its editor moves. Anything else would put one task in two places:
  // a copy (dragging with Ctrl or Alt), or a drop from another editor, such as another day's
  // box on a label's page.
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      new Plugin({
        props: {
          handleDrop: (view, event, slice, moved) => {
            if (moved) return false;
            let hasTask = false;
            slice.content.descendants((node) => {
              if (node.type.name === name) hasTask = true;
            });
            return hasTask;
          },
        },
      }),
    ];
  },

  // "[] " (or "[ ] ") at the start of a top-level paragraph, or of one directly in a notes box,
  // turns it into a task; any text already on the line becomes the title. One made in a box
  // takes the box's label as its category.
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[\s?\]\s$/,
        handler: ({ state, range }) => {
          const $start = state.doc.resolve(range.from);
          const inBox = $start.depth === 2 && $start.node(1).type.name === NOTE_BOX;
          if (($start.depth !== 1 && !inBox) || $start.parent.type.name !== 'paragraph') return null;
          const rest = $start.parent.textBetween(range.to - $start.start(), $start.parent.content.size).trim();
          const id = newId();
          justCreated.add(id);
          this.options.onCreate(id, rest, boxLabel($start));
          const { tr } = state;
          tr.replaceWith($start.before(), $start.after(), this.type.create({ id }));
          // Select the block itself rather than leaving a text cursor between blocks.
          tr.setSelection(NodeSelection.create(tr.doc, $start.before()));
        },
      }),
    ];
  },
});

function TaskBlockView({ node, editor, getPos, extension }) {
  const id = node.attrs.id;
  const task = useQuery('task', [id]);
  const today = useToday();
  const [draft, setDraft] = useState(null);
  // A block made here a moment ago takes typing right away, before its task row loads.
  const [isNew] = useState(() => justCreated.has(id));
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const subtasksOpen = useSubtasksOpen(id);
  const save = useDebounced((title) => action.updateItem(id, { title }), 500);
  const title = draft ?? task?.title ?? '';
  const editable = Boolean(task) || isNew;

  useEffect(() => {
    if (!isNew) return;
    justCreated.delete(id);
    inputRef.current?.focus();
  }, [isNew, id]);

  // The editor makes a draggable block's whole element draggable. Only the grip should be:
  // inside a draggable element, Firefox won't put the cursor where a title is clicked, and no
  // browser lets the mouse select text in it.
  useLayoutEffect(() => {
    const dom = wrapperRef.current?.parentElement;
    if (dom?.draggable) dom.draggable = false;
  }, []);

  // Once the task loads, since the title box waits for it.
  useEffect(() => {
    if (task && justMoved.delete(id)) inputRef.current?.focus();
  }, [task, id]);

  // Drop the local draft once the saved title catches up with it: compared with the draft as
  // it is then, or a letter typed since this render would be lost.
  useEffect(() => {
    if (task) setDraft((d) => (d === task.title ? null : d));
  }, [task?.title, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Put the cursor in the nearest text position before (bias -1) or after (1) `pos`.
  const focusNear = (pos, bias) =>
    editor
      .chain()
      .command(({ tr }) => {
        tr.setSelection(Selection.near(tr.doc.resolve(Math.min(Math.max(pos, 0), tr.doc.content.size)), bias));
        return true;
      })
      .focus()
      .run();

  // Take the block out of the note. The last block in a box leaves an empty line, since a box
  // can't be empty.
  const removeBlock = () => {
    const from = getPos();
    const to = from + node.nodeSize;
    if (editor.state.doc.resolve(from).parent.childCount === 1) {
      editor.chain().insertContentAt({ from, to }, { type: 'paragraph' }, { updateSelection: false }).run();
    } else {
      editor.chain().deleteRange({ from, to }).run();
    }
  };

  const remove = () => {
    action.deleteTask(id);
    removeBlock();
  };

  // Move the block one step up (-1) or down (1): past the block next to it, into a notes box
  // next to it (to its nearest end), or out of the box it's in at either end.
  const move = (dir) => {
    const pos = getPos();
    const size = node.nodeSize;
    const $pos = editor.state.doc.resolve(pos);
    const { parent, depth } = $pos;
    const index = $pos.index();
    const neighbor = dir < 0 ? (index > 0 ? parent.child(index - 1) : null) : index < parent.childCount - 1 ? parent.child(index + 1) : null;
    let target;
    if (neighbor) {
      const intoBox = neighbor.type.name === NOTE_BOX;
      if (dir < 0) target = intoBox ? pos - 1 : pos - neighbor.nodeSize;
      else target = intoBox ? pos + size + 1 : pos + size + neighbor.nodeSize;
    } else if (depth > 0 && parent.type.name === NOTE_BOX) {
      target = dir < 0 ? $pos.before() : $pos.after();
    } else {
      return;
    }
    const { state, view } = editor;
    const $target = state.doc.resolve(target);
    if (!$target.parent.canReplaceWith($target.index(), $target.index(), node.type)) return;
    const { tr } = state;
    // Take it out of its place; a box it was the only thing in keeps an empty line.
    const lift = () =>
      parent.childCount === 1 ? tr.replaceWith(pos, pos + size, state.schema.nodes.paragraph.create()) : tr.delete(pos, pos + size);
    // Change the later position first, so the earlier one still holds.
    if (target > pos) {
      tr.insert(target, node);
      lift();
    } else {
      lift();
      tr.insert(target, node);
    }
    save.flush();
    justMoved.add(id);
    view.dispatch(tr);
    // The editor may move this block's view rather than make a new one: focus it here then.
    if (inputRef.current?.isConnected) {
      justMoved.delete(id);
      inputRef.current.focus();
    }
  };

  const onKeyDown = (e) => {
    const from = getPos();
    const to = from + node.nodeSize;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      save.flush();
      if (!title.trim()) {
        // Enter on an empty task turns it back into a paragraph.
        action.deleteItem(id);
        editor.chain().insertContentAt({ from, to }, { type: 'paragraph' }, { updateSelection: false }).run();
        focusNear(from + 1, 1);
      } else {
        const next = newId();
        justCreated.add(next);
        extension.options.onCreate(next, '', boxLabel(editor.state.doc.resolve(from)));
        editor.chain().insertContentAt(to, { type: 'taskRef', attrs: { id: next } }, { updateSelection: false }).run();
      }
    } else if (e.key === 'Backspace' && !title) {
      e.preventDefault();
      remove();
      focusNear(from, -1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusNear(from, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusNear(to, 1);
    }
  };

  return (
    <NodeViewWrapper ref={wrapperRef} className="task-block-item">
      <div className={`task-block ${task?.status ?? 'missing'}`}>
        {/* The editor drags the block by this; Alt+↑/↓ in the title moves it from the keyboard. */}
        <span className="drag-handle" contentEditable={false} draggable="true" data-drag-handle="" title="Drag to move" aria-hidden="true">
          <GripIcon />
        </span>
        <input
          type="checkbox"
          className="check"
          checked={task?.status === 'done'}
          disabled={!task}
          onChange={() => action.setTaskStatus(id, task.status === 'open' ? 'done' : 'open')}
          aria-label="Done"
        />
        <input
          ref={inputRef}
          className="task-block-title"
          value={title}
          disabled={!editable}
          placeholder={editable ? 'Task' : 'Task not synced yet'}
          onChange={(e) => {
            setDraft(e.target.value);
            save(e.target.value);
          }}
          onBlur={() => save.flush()}
          onKeyDown={onKeyDown}
          aria-label="Task title"
        />
        {task && <SubtaskChip task={task} isOpen={subtasksOpen} />}
        {task && <CategoryChip value={task.category} onChange={(name) => action.setCategory(id, name)} />}
        <span className="date-slot">
          {task?.status === 'open' && (
            <DateChip
              value={task.due}
              today={today}
              quiet={task.due === extension.options.day}
              onChange={(due) => action.updateItem(id, { due })}
            />
          )}
        </span>
        <button className="row-delete" onClick={remove} aria-label="Delete task" title="Delete task">
          <TrashIcon />
        </button>
      </div>
      {task && subtasksOpen && <SubtaskList parentId={id} />}
    </NodeViewWrapper>
  );
}
