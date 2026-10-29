// The task list shows categories in an order of your choosing. It is one list of names, kept in
// props under this row, so every device shows the same order.
export const CATEGORY_ORDER = 'settings/categoryOrder';

// Category names in the chosen order: the ones in `order` first, as there, then the rest
// (new ones, and ones never moved) alphabetically.
export function orderCategories(names, order = []) {
  const rank = new Map(order.map((name, i) => [name, i]));
  return [...names].sort((a, b) => {
    const ra = rank.get(a) ?? Infinity;
    const rb = rank.get(b) ?? Infinity;
    return ra !== rb ? ra - rb : a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

// The order to save after moving `name` to `index` among the categories `shown`, in their
// current order. Categories in the old order that aren't shown (none of their tasks is open)
// keep their relative places, after the shown ones.
export function moveCategory(shown, order, name, index) {
  const next = shown.filter((n) => n !== name);
  next.splice(index, 0, name);
  return [...next, ...order.filter((n) => !shown.includes(n))];
}

// The category a typed name refers to: an existing one whatever its case, else a new one.
// Blank means none.
export function matchCategory(text, categories = []) {
  const name = text.trim();
  if (!name) return null;
  return categories.find((c) => c.toLowerCase() === name.toLowerCase()) ?? name;
}
