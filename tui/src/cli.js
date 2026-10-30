#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { adaptBetterSqlite, createQueries, eventTime, fullDay, localDate, normalizeServerUrl, relativeDay } from '@almanac/shared';
import { addTask, attachFiles, dayReport, describeTask, fileSize, logText } from './commands.js';
import { checkServer, locations, readConfig, writeConfig } from './config.js';
import { askRunning, serveControl } from './control.js';
import { ReplicaContext } from './hooks.js';
import { openReplica } from './replica.js';
import { askBackground, focusReports, terminalInput } from './term.js';
import { width as columns } from './text.js';
import { makeTheme } from './theme.js';
import { App } from './views/App.js';

const USAGE = `Almanac in the terminal: your journal and tasks, kept on this machine and synced.

  almanac                  the full-screen journal and tasks
  almanac add "<text>"     add a task, read as the task box reads it: "submit abstract fri #paper"
  almanac today [--json]   today's events, what's due today, what's overdue, and what got finished
  almanac log "<text>"     a paragraph at the end of today's journal (or text piped in)
  almanac attach <image>   an image at the end of today's journal, made smaller as the web does
  almanac sync             sync now, and say how it went

  --server <address>       the server to sync with, such as https://<host>.<tailnet>.ts.net:8787.
                           Needed the first time; it's kept in ~/.config/almanac/config.json.
`;

const COMMANDS = ['add', 'today', 'log', 'attach', 'sync'];

class Failure extends Error {}

function parseArgs(argv) {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') words.push(...argv.slice(i + 1)), (i = argv.length);
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version') flags.version = true;
    else if (arg === '--server') flags.server = argv[++i] ?? '';
    else if (arg.startsWith('--server=')) flags.server = arg.slice('--server='.length);
    else if (arg.startsWith('-') && arg.length > 1) throw new Failure(`Unknown option ${arg}.\n\n${USAGE}`);
    else words.push(arg);
  }
  return { flags, command: words[0] ?? null, rest: words.slice(1) };
}

// Runs a command against this machine's copy: in this process when no TUI is running (taking
// the copy's lock for the while), else in the TUI's, over its socket.
async function withCopy(paths, server, request, here) {
  for (let tries = 0; ; tries++) {
    const replica = openReplica({ paths, server, requireLock: true });
    if (replica) {
      try {
        return await here(replica);
      } finally {
        replica.close();
      }
    }
    try {
      return await askRunning(paths.socket, request);
    } catch (err) {
      // Another command has the copy for a moment, or a TUI is just starting.
      if (!['ENOENT', 'ECONNREFUSED'].includes(err.code)) throw new Failure(err.message);
      if (tries >= 50) throw new Failure('Almanac’s copy is busy in another process. Try again in a moment.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// How a sync went, in a sentence, and whether it went through.
function syncReport(status, server) {
  const waiting = status.pending === 1 ? '1 change is waiting' : `${status.pending} changes are waiting`;
  if (status.error) return { ok: false, text: `Sync error: ${status.error}` };
  if (!status.online) return { ok: false, text: `Couldn’t reach ${server}${status.reason ? ` (${status.reason})` : ''}.${status.pending ? ` ${waiting}.` : ''}` };
  return { ok: true, text: status.pending ? `Synced, but ${waiting}.` : 'Synced. Nothing waiting.' };
}

// The control socket's requests, answered by the running TUI.
const controlHandler = (replica) => async (request) => {
  if (request.cmd === 'add') {
    return { task: addTask(replica, request.text) };
  }
  if (request.cmd === 'log') return { date: logText(replica, request.text, request.date) };
  if (request.cmd === 'attach') return { images: await attachFiles(replica, request.files, request.date) };
  if (request.cmd === 'sync') return { status: await replica.sync() };
  throw new Error(`Unknown request ${request.cmd}`);
};

async function readAll(stream) {
  let text = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) text += chunk;
  return text;
}

function todayText(report, today) {
  const width = Math.min(process.stdout.columns || 80, 96);
  const line = (t) => {
    const done = t.status === 'done';
    const left = `  ${chalk.hex('#9b958b')(done ? '[x]' : '[ ]')} ${done ? chalk.strikethrough.dim(t.title) : t.title}`;
    const date = t.due && t.status === 'open' && t.due !== today ? relativeDay(t.due, today) : '';
    const right = [t.category && chalk.cyan(t.category), date && (t.due < today ? chalk.red(date) : chalk.dim(date))].filter(Boolean).join('   ');
    // Measured in columns, so a title with wide characters still lines up (styling isn't counted).
    const gap = Math.max(2, width - columns(left) - columns(right));
    return right ? `${left}${' '.repeat(gap)}${right}` : left;
  };
  const out = [];
  if (report.events.length) {
    const times = report.events.map((e) => eventTime(e, today));
    const tw = Math.max(...times.map(columns));
    out.push(chalk.bold.dim('Events today'));
    report.events.forEach((e, i) => {
      const where = e.location ? chalk.dim(` · ${e.location}`) : '';
      out.push(`  ${chalk.hex('#9b958b')(times[i])}${' '.repeat(tw - columns(times[i]) + 2)}${e.title ?? '(No title)'}${where}`);
    });
  }
  for (const [name, list] of [
    ['Due today', report.due],
    ['Overdue', report.overdue],
    ['Finished', report.finished],
  ]) {
    if (!list.length) continue;
    out.push(chalk.bold.dim(name), ...list.map(line));
  }
  return out.length ? out.join('\n') : 'Nothing due today.';
}

async function runTui(paths, server) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Failure('The full-screen app needs a terminal. almanac add, today and sync work without one.');
  }
  let replica;
  try {
    replica = openReplica({ paths, server });
  } catch (err) {
    throw new Failure(err.message);
  }
  // The copy's lock holder answers other commands; a read-only TUI starts to once it takes over.
  let control = null;
  const serve = () => {
    if (!control && !replica.status.readOnly) control = serveControl(paths.socket, controlHandler(replica));
  };
  serve();
  replica.onStatus(serve);

  const term = terminalInput(process.stdin);
  term.input.setRawMode(true);
  const config = readConfig(paths.config);
  const background = await askBackground(process.stdout, term.events);
  const theme = makeTheme({ background, mode: config.mode, scheme: config.scheme, level: chalk.level });
  replica.start();
  // Back in the terminal after a while away: get what other devices did meanwhile.
  term.events.on('focus', () => replica.sync());
  focusReports(process.stdout, true);
  const ink = render(h(ReplicaContext.Provider, { value: replica }, h(App, { theme, paths })), {
    stdin: term.input,
    alternateScreen: true,
    exitOnCtrlC: false,
    incrementalRendering: true,
  });
  const stop = () => ink.unmount();
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  // The terminal closed under it: there's nothing to draw on, and what was written is saved as
  // it stops.
  const gone = (err) => {
    if (err.code !== 'EIO' && err.code !== 'EPIPE') throw err;
  };
  process.stdout.on('error', gone);
  process.stdin.on('error', gone);
  try {
    await ink.waitUntilExit();
  } finally {
    focusReports(process.stdout, false);
    control?.close();
    term.close();
    replica.close();
  }
}

async function main(argv) {
  const { flags, command, rest } = parseArgs(argv);
  if (flags.help || command === 'help') return void process.stdout.write(USAGE);
  // Before anything else, so a typo isn't answered with what to set up first.
  if (command && !COMMANDS.includes(command)) throw new Failure(`Unknown command “${command}”.\n\n${USAGE}`);
  if (flags.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return void console.log(pkg.version);
  }
  const paths = locations();
  let server = readConfig(paths.config).server ?? null;
  if (flags.server !== undefined) {
    const url = normalizeServerUrl(flags.server);
    if (!url) throw new Failure(`“${flags.server}” isn’t a server address. It looks like https://<host>.<tailnet>.ts.net:8787.`);
    const check = await checkServer(url);
    if (!check.ok) throw new Failure(`Couldn’t use ${url}. ${check.message}`);
    writeConfig(paths.config, { server: url });
    server = url;
  }
  const today = localDate();

  if (command === 'today') {
    if (!fs.existsSync(paths.db)) throw new Failure('There’s no copy on this machine yet. Run almanac --server <address> first.');
    const raw = new Database(paths.db, { readonly: true, fileMustExist: true });
    try {
      const report = dayReport(createQueries(adaptBetterSqlite(raw)), today);
      console.log(flags.json ? JSON.stringify(report, null, 2) : todayText(report, today));
    } finally {
      raw.close();
    }
    return;
  }

  if (!server) throw new Failure('Almanac doesn’t know your server yet. Run it once with --server <address>, such as\n  almanac --server https://<host>.<tailnet>.ts.net:8787');

  if (command === 'add') {
    const text = rest.join(' ').trim();
    if (!text) throw new Failure('Give the task as text: almanac add "submit abstract fri #paper"');
    const { task, status } = await withCopy(paths, server, { cmd: 'add', text }, async (replica) => {
      try {
        return { task: addTask(replica, text), status: await replica.sync() };
      } catch (err) {
        throw new Failure(err.message);
      }
    });
    console.log(`Added ${describeTask(task, today)}${task.isNew ? ' (a new category)' : ''}`);
    if (status && !syncReport(status, server).ok) console.log('It’s saved on this machine, and goes to the server with the next sync.');
    return;
  }

  if (command === 'log') {
    let text = rest.join(' ');
    if (!text.trim() && !process.stdin.isTTY) text = await readAll(process.stdin);
    if (!text.trim()) throw new Failure('Give the text to log: almanac log "Asked about the new PSF."');
    const { status } = await withCopy(paths, server, { cmd: 'log', text, date: today }, async (replica) => {
      try {
        logText(replica, text, today);
        return { status: await replica.sync() };
      } catch (err) {
        throw new Failure(err.message);
      }
    });
    console.log(`Added to ${fullDay(today, today)}.`);
    if (status && !syncReport(status, server).ok) console.log('It’s saved on this machine, and goes to the server with the next sync.');
    return;
  }

  if (command === 'attach') {
    if (!rest.length) throw new Failure('Give the image to add: almanac attach plot.png');
    const files = rest.map((file) => path.resolve(file));
    const { images, status } = await withCopy(paths, server, { cmd: 'attach', files, date: today }, async (replica) => {
      try {
        return { images: await attachFiles(replica, files, today), status: await replica.sync() };
      } catch (err) {
        throw new Failure(err.message);
      }
    });
    for (const image of images) {
      const name = image.alt ? `“${image.alt}”` : image.name;
      console.log(`Added ${name}${image.smaller ? ', made smaller' : ''} (${image.width} × ${image.height}, ${fileSize(image.size)}) to ${fullDay(today, today)}.`);
    }
    if (status && !syncReport(status, server).ok) console.log('It’s saved on this machine, and goes to the server with the next sync.');
    return;
  }

  if (command === 'sync') {
    const { status } = await withCopy(paths, server, { cmd: 'sync' }, async (replica) => ({ status: await replica.sync() }));
    const report = syncReport(status, server);
    if (!report.ok) throw new Failure(report.text);
    console.log(report.text);
    return;
  }

  await runTui(paths, server);
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`${err instanceof Failure ? err.message : err.stack}\n`);
    process.exit(1);
  },
);
