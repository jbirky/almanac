import { fit, piece } from '../text.js';

// The places a pane's cursor can stop, in order, from its rows (see dayRows): each { key, index,
// end, data }, its rows being index to end.
export function stopsOf(rows) {
  const stops = [];
  rows.forEach((row, i) => {
    if (row.stop) stops.push({ key: row.stop, index: i, end: i + 1, data: row.data });
    else if (row.part && stops.at(-1)?.key === row.part) stops.at(-1).end = i + 1;
  });
  return stops;
}

// The stop the cursor is on: the one with its key, else the one now where it was (what it was
// on went away, such as a task checked off), else the first.
export function findStop(stops, key, index = 0) {
  return stops.find((s) => s.key === key) ?? stops[Math.min(index, stops.length - 1)] ?? null;
}

// The first row to show: as near `top` as shows all of `stop`, and no further down than fills
// the pane.
export function scrollTo(stop, height, top, total) {
  let next = top;
  if (stop) {
    if (stop.end - next > height) next = stop.end - height;
    if (stop.index < next) next = stop.index;
  }
  return Math.max(0, Math.min(next, total - height));
}

// A pane on screen: `height` lines `w` columns wide from row `top`, each after a one-column
// gutter that marks the cursor's rows while the pane has focus.
export function paneLines(rows, { w, height, top, stop, focused, theme }) {
  const lines = [];
  for (let i = top; i < top + height; i++) {
    const row = rows[i];
    const marked = focused && stop && i >= stop.index && i < stop.end && !row?.popup;
    const gutter = piece(marked ? '▌' : ' ', { fg: theme.accent });
    if (!row) {
      lines.push([gutter, piece(' '.repeat(w - 1))]);
      continue;
    }
    const margin = row.margin ?? 0;
    lines.push([gutter, piece(' '.repeat(margin)), ...fit(row.line, w - 1 - margin, row.bg)]);
  }
  return lines;
}
