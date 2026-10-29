import { Node, mergeAttributes } from '@tiptap/core';

// A [[link]] to a page, from when the app had pages. Pages are gone, so an old link shows
// its title as plain text. The node has to stay in the schema: the editor deletes elements
// it doesn't know from the stored body.
export const LegacyItemRef = Node.create({
  name: 'itemRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-item-id'),
        renderHTML: (attrs) => ({ 'data-item-id': attrs.id }),
      },
      label: { default: '', parseHTML: (el) => el.textContent, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-item-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'item-ref' }), node.attrs.label || 'Untitled'];
  },

  renderText({ node }) {
    return node.attrs.label;
  },
});
