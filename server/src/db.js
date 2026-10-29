import Database from 'better-sqlite3';
import { adaptBetterSqlite } from '@almanac/shared';

export function openDatabase(file) {
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');
  return { raw, db: adaptBetterSqlite(raw) };
}
