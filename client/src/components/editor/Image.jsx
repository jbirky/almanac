import { Node } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { newId } from '@almanac/shared';
import { ImageError, prepareImage, saveImage, useImageUrl } from '../../lib/images.js';
import { notify } from '../Notices.jsx';

const number = (value) => Number(value) || null;

// An image in a note: a block of its own that names its file (lib/images.js) by id. Image
// files dropped on a note or pasted into it are added; an image can be dragged to move it.
export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      file: { default: null, parseHTML: (el) => el.dataset.file, renderHTML: ({ file }) => ({ 'data-file': file }) },
      alt: { default: '' },
      // Its size in pixels, so the page keeps its place before it loads.
      width: { default: null, parseHTML: (el) => number(el.getAttribute('width')) },
      height: { default: null, parseHTML: (el) => number(el.getAttribute('height')) },
    };
  },

  // Only images copied from a note; pictures pasted from web pages aren't fetched.
  parseHTML() {
    return [{ tag: 'img[data-file]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  renderText: ({ node }) => (node.attrs.alt ? `[${node.attrs.alt}]` : '[image]'),

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addProseMirrorPlugins() {
    const { type } = this;
    return [
      new Plugin({
        props: {
          handleDrop(view, event, slice, moved) {
            const files = event.dataTransfer?.files;
            if (moved || !files?.length) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            addImages(view, type, files, at?.pos ?? view.state.selection.from);
            return true;
          },
          // An image on the clipboard, such as a screenshot. Copied text that comes with a
          // picture of itself (as from a spreadsheet) is pasted as text.
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data?.files.length || data.getData('text/plain').trim()) return false;
            addImages(view, type, data.files, null);
            return true;
          },
        },
      }),
    ];
  },
});

// Puts image files into the note at `pos` (where they were dropped) or, with null, in place
// of the selection. Other files are left out, with a note saying so.
async function addImages(view, type, fileList, pos) {
  const files = [...fileList];
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length < files.length) {
    notify(images.length ? 'Only images can go in notes; the other files were left out.' : 'Only images can go in notes.');
  }
  const prepared = [];
  for (const file of images) {
    try {
      prepared.push({ file, image: await prepareImage(file) });
    } catch (err) {
      if (!(err instanceof ImageError)) console.error(err);
      notify(err instanceof ImageError ? err.message : `Couldn't add “${file.name}”.`);
    }
  }
  if (!prepared.length || view.isDestroyed) return;

  const nodes = [];
  for (const { file, image } of prepared) {
    const id = newId();
    await saveImage(id, image);
    nodes.push(type.create({ file: id, alt: altText(file.name), width: image.width, height: image.height }));
  }
  if (view.isDestroyed) return;
  const { state } = view;
  const { tr } = state;
  const slice = new Slice(Fragment.from(nodes), 0, 0);
  if (pos !== null) {
    // The note may have changed while the images were read; the nearest place a block fits.
    const at = Math.min(pos, state.doc.content.size);
    const point = dropPoint(state.doc, at, slice) ?? at;
    tr.replaceRange(point, point, slice);
  } else {
    // Pasted: the images go at the cursor, splitting its line, and the cursor goes on below
    // them (on a new line if none follows), so typing doesn't replace them.
    const { $from, empty } = tr.selection;
    const emptyLine = empty && $from.parent.isTextblock && !$from.parent.content.size && $from.depth > 0;
    if (emptyLine && $from.node(-1).canReplace($from.index(-1), $from.indexAfter(-1), slice.content)) {
      tr.replaceWith($from.before(), $from.after(), slice.content);
    } else {
      tr.replaceSelection(slice);
    }
    const last = nodes.at(-1).attrs.file;
    let end = null;
    tr.doc.descendants((node, at) => {
      if (node.type === type && node.attrs.file === last) end = at + node.nodeSize;
      return end === null;
    });
    if (end !== null) {
      if (!tr.doc.resolve(end).nodeAfter?.isTextblock) tr.insert(end, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, end + 1));
    }
  }
  view.dispatch(tr.scrollIntoView());
}

// "light curve fit.png" -> "light curve fit". A pasted screenshot is just "image".
function altText(name) {
  const stem = name.replace(/\.[^.]+$/, '').trim();
  return stem.toLowerCase() === 'image' ? '' : stem;
}

function ImageView({ node, selected }) {
  const { file, alt, width, height } = node.attrs;
  const url = useImageUrl(file);
  return (
    <NodeViewWrapper className={`image-block${selected ? ' selected' : ''}`} data-drag-handle>
      {url ? (
        <img src={url} alt={alt} width={width ?? undefined} height={height ?? undefined} draggable={false} />
      ) : (
        // Until it syncs here, a box its size.
        <span className="image-waiting" style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
          {alt ? `“${alt}” hasn't synced to this device yet` : "This image hasn't synced to this device yet"}
        </span>
      )}
    </NodeViewWrapper>
  );
}
