import * as chrono from 'chrono-node';
import { localDate } from './util.js';

// Parses a quick-capture line such as "submit abstract due fri #paper". The first #word is
// the category. The first date in the line becomes the due date and is taken out of the
// title, along with a "due", "by" or "before" just ahead of it.
export function parseCapture(text, ref = new Date()) {
  let category = null;
  let title = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/u, (_, space, name) => {
    category = name;
    return space;
  });
  let due = null;
  const [match] = chrono.parse(title, ref, { forwardDate: true });
  if (match) {
    const keyword = /\b(due|by|before)\s*$/i.exec(title.slice(0, match.index));
    const start = keyword ? keyword.index : match.index;
    due = localDate(match.start.date());
    title = title.slice(0, start) + title.slice(match.index + match.text.length);
  }
  return { title: title.replace(/\s+/g, ' ').trim(), due, category };
}
