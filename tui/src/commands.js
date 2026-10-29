import fs from 'node:fs';
import path from 'node:path';
import { journalId, localDate, matchCategory, newId, parseCapture, shortDay } from '@almanac/shared';
import { ImageError, altText, prepareImage } from './images.js';
import { appendBlocks, appendLines, element } from './journal/doc.js';

// A task from a line such as "submit abstract fri #paper", read as the web's task box reads it:
// the first #word is its category (one in use whatever its case, else a new one) and the first
// date its due date, else `due`. Returns what was added, with `isNew` for a new category.
export function addTask(replica, text, due = null) {
  const parsed = parseCapture(text);
  if (!parsed.title) throw new Error('Nothing to add: the task needs a title.');
  const categories = replica.queries.categories();
  const category = parsed.category ? matchCategory(parsed.category, categories) : null;
  const task = { title: parsed.title, due: parsed.due ?? due, category };
  task.id = replica.act('captureTask', task);
  return { ...task, isNew: Boolean(category && !categories.includes(category)) };
}

// "submit abstract · due Fri, Oct 30 · paper"
export function describeTask({ title, due, category }, today) {
  return [title, due && `due ${shortDay(due, today)}`, category].filter(Boolean).join(' · ');
}

// A day's Due panel as plain data, for `almanac today --json`.
export function dayReport(queries, date) {
  const pick = ({ id, title, status, due, category, subtasks, subtasks_done }) => ({ id, title, status, due, category, subtasks, subtasks_done });
  const { due, overdue, finished } = queries.dayTasks(date, date);
  return { date, due: due.map(pick), overdue: overdue.map(pick), finished: finished.map(pick) };
}

// Text at the end of a day's journal, a paragraph for each line, for `almanac log`. Written into
// the day's open document if the TUI has it on screen, and saved at once. Returns the day.
export function logText(replica, text, date = localDate()) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd());
  while (lines.length && !lines.at(-1)) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  if (!lines.length) throw new Error('Nothing to add: give the text to log.');
  replica.bodies.edit(journalId(date), () => replica.act('ensureJournal', date), (session) => appendLines(session.fragment, lines));
  return date;
}

// Image files at the end of a day's journal, for `almanac attach`, each made ready as the web
// makes an image dropped on a note: kept as it is if it's small, else made smaller. All are read
// before any is added, so one that can't be adds none. Returns what was added, each { name, alt,
// width, height, size, smaller }.
export async function attachFiles(replica, files, date = localDate()) {
  const images = [];
  for (const file of files) {
    const name = path.basename(file);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch (err) {
      throw new ImageError(err.code === 'ENOENT' ? `There’s no file ${file}.` : `Couldn’t read ${file}: ${err.message}`);
    }
    images.push({ ...(await prepareImage(bytes, name)), name, alt: altText(name), id: newId() });
  }
  for (const image of images) replica.act('addFile', image.id, image.type, image.bytes);
  const blocks = images.map((i) => element('image', { file: i.id, alt: i.alt, width: i.width, height: i.height }));
  replica.bodies.edit(journalId(date), () => replica.act('ensureJournal', date), (session) => appendBlocks(session.fragment, blocks));
  return images.map(({ name, alt, width, height, bytes, smaller }) => ({ name, alt, width, height, size: bytes.length, smaller }));
}

// "1.2 MB", "340 KB".
export const fileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
