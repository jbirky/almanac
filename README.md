# Almanac

A self-hosted, local-first journal and to-do list for one person. One screen, two panels: a calendar and your open tasks on the left, the journal on the right, one day at a time or one label at a time. Drag the border between them to make the left panel wider or narrower (double-click it to reset); each browser keeps its own width. Each device keeps a full copy of the data and syncs with your server, so it keeps working offline.

Design doc: https://claude.ai/code/artifact/d6e85fe6-555f-4728-8df4-7c3c2282c761 (written for the earlier, multi-page version; the storage and sync parts still apply).

## What it does

**Left panel**
- **Calendar:** a year of days in a GitHub-style grid, one column per week. A day is shaded by how many tasks you finished, outlined if you wrote in its journal, and dotted if something is due. Click a day, or use the arrow keys, to open it.
- **Tasks:** every open task, grouped by category. Categories go in the order you put them in: drag the grip beside a category's name (it shows on hover, and works by touch too), or focus it and press ↑ or ↓. Categories you haven't moved come after, alphabetically, and uncategorized tasks come last. Tasks move the same way, by the grip beside each: drag one up or down its category, or into another category's tasks to give it that category (into *No category* to take its category away); ↑ and ↓ on its grip move it within its category. Tasks you haven't moved come first in their category, soonest due first, so a new one shows at the top. A task given another category with its chip starts at the top of it. Both orders are the same on every device. Add one with the box above the list: `submit abstract fri #paper` sets the due date and files it under *paper*, and both are previewed before you press Enter, with "new" on a category that doesn't exist yet. Without a date in the text, the task has no due date; undated tasks come after the dated ones in their category. Click a task's category chip to type a new category or pick an existing one (an empty box removes it), its date chip to pick another date (the × in the chip removes the date), its title to rename it (the cursor goes where you click), or the trash can at the end of the row to delete it. A task with no category, date or subtasks shows small icons for them on hover. In the list, the category chip shows on hover too.
- **Subtasks:** click a task's subtasks icon (or its "2/5" count, once it has some) to show its subtasks under it, with a box to add more. Check them off, rename them in place, or delete them; Enter in one goes on to the next. A subtask has no date or category of its own and is listed only under its task, which shows how many are done. Whether a task's subtasks are showing is remembered in each browser, for every place the task appears. Deleting a task deletes its subtasks.
- **Search:** full-text search over journals and task titles, run locally. Matching days light up on the calendar and are listed below it.

**Right panel: the journal, by day or by label.** Switch with **By day | By label** at the top right. Each side goes back to the day or label you last had open.

*By day*
- **Events:** with a calendar set up on the server, such as your Proton Calendar (see [Calendars](#calendars)), each day starts with its events: all-day ones first, then by time, in your device's time zone, with where each is. **Notes** under one opens its description, and a link in either opens in a new tab. They come with sync, so they show offline too. They're read-only here; change them in Proton Calendar.
- **Due panel:** at the top of each day (under its events, with a calendar set up), "Due today" (or "Due tomorrow", "Due on Thu, Oct 29") lists every task due that day, ones written in a journal included, open ones first and finished ones checked off below them. On a day with nothing due it says so. Its box adds a task due that day (`#category` works, and a date typed in still wins). Today's panel also lists overdue tasks, and every day's lists the tasks finished that day that weren't due then ("Also finished"), except ones in that day's journal, which already shows them.
- **Journal:** rich text (TipTap), one page per day. Type `[] ` at the start of a line to add a task. It starts with no due date and appears in the list on the left too. Hover it to give it a category, a due date or subtasks, or to delete it with the trash can. Drag it by the grip that appears in the margin to its left to move it anywhere in the journal, into or out of a notes box too; `Alt+↑`/`Alt+↓` in its title does the same a step at a time, into a box next to it and out at a box's ends. Two devices writing in the same day offline merge into one page.
- **Equations:** write LaTeX as you would in a paper. `$E = mc^2$` becomes a formula in the line once you type the closing `$` (a price such as "$5 and $10" stays text, and Backspace right after turns a formula back into text). A line that is nothing but `$$\int_0^1 x^2\,dx$$` becomes an equation set on its own. Click a formula, or select it and press Enter, to edit its LaTeX with the formula updating as you type: Enter keeps it, Esc undoes the change, and emptying it removes it. Rendered with KaTeX, offline; what it can't read shows in red in place. A formula's LaTeX counts as text for search.
- **Images:** drag image files onto the journal or a notes box to put them where you drop them, or paste one (a screenshot, say) at the cursor. Click one to select it, then press Backspace to remove it, or drag it to move it. They show at their own size, up to the width of the page. One under 1.5 MB is kept as it is, so a plot stays sharp. A larger one is saved smaller, as WebP (JPEG in Safari) and at most 2400 pixels on its longest side. GIFs and animated WebPs are kept whole, up to 5 MB. Images sync like everything else and are kept on every device, so they show offline too. One you take out of your notes is kept for 30 days, so undoing or pasting it back still works, then removed from the server and every device. Other kinds of files aren't accepted, and a file or link dropped anywhere else on the page is ignored rather than opened in place of the app.
- **GIFs and images from the web:** paste a link to an image, or to a GIF on Giphy or Tenor (its page's address will do), and the image goes in instead of the link. A picture copied on a web page (*Copy image*) and pasted, or dragged in from another tab, goes in too. Your server fetches the original, so a GIF still moves: the copy a browser puts on the clipboard is a still picture. If it can't be fetched (offline, say), the browser's copy goes in, or else the link as text, with a note saying why. Links to anything but images stay text.
- **Notes boxes:** a part of the day's journal under a colored label, such as a meeting's, a paper's or a lecture's notes. Type `#meeting ` at the start of a line to start one labeled *meeting* (any label of that name, whatever its case or spacing, so `#papernotes` finds *Paper notes*; otherwise a new one), or click **+ Notes box** under the journal and pick or create a label. A box holds anything the journal does, `[]` tasks included, but not another box. A task started in a box (with `[] `, or Enter in another task there) is filed under the box's label as its category, or under a category of that name you already use, whatever its case; its chip changes it. Moving a task into a box later leaves its category alone. Press Enter on an empty last line to leave it, and Backspace in an empty box to remove it. Drag a box by the grip beside its label to move it, notes and all, anywhere else in the journal. Click a box's label to change it. From there you can also open all of that label's notes, rename or recolor the label everywhere, delete it (its boxes keep their notes), remove the box and keep its notes, or pin it.
- **Pinned boxes:** a box pinned from its label menu shows at the top of every day after its own, under the Due panel, with a thumbtack and the day it's on (click that to open it). It's the box itself, not a copy: what you write in it there, tasks included, is written in it on its own day, and the next day shows it too. **Unpin** on a later day takes it off that day and the days after; the days before still show it. Unpinning from its own day's label menu takes it off them all. On its own day, a pinned box has a thumbtack beside its label. Each new label takes the color fewest labels have, out of eight that work in light and dark mode. To give a label any other color, click the rainbow swatch after the eight and use your browser's color picker. If a color is too pale to read as text in light mode, or too dark in dark mode, labels show a darker or lighter shade of it in that mode, and the editor says so.

*By label*
- One label's notes across days: a section per day with a box under that label, newest first, plus one for today even when it has none. It opens on the label you used most recently; the chips under its name switch labels, and **Edit label** renames, recolors or deletes it. The calendar lights up the label's days in its color.
- Each section is that day's box itself, not a copy, so you can write in it, add `[]` tasks, and Backspace in an empty one to remove it, as in the day's journal. When today has no box under the label, **+ Add to today** starts one at the end of today's journal. Click a section's date to open that day. Older days load 14 at a time.

**Settings** (the gear after **By day | By label**): light or dark (or match the system), one of six color schemes (Paper, Ocean, Rose, Plum, Sand, Graphite), and a font: the system's or one of twelve bundled ones, in sans-serif (Inter, IBM Plex Sans, Nunito, Atkinson Hyperlegible, and Shantell Sans, which looks handwritten), serif (Literata, Source Serif, Newsreader, Merriweather, EB Garamond) and monospaced (JetBrains Mono, Courier Prime). EB Garamond's small letters are scaled up to match the others (in browsers with `font-size-adjust`). Each scheme is checked for 4.5:1 text in both modes. They apply at once and are kept in each browser, not synced, so a phone can stay dark while a laptop is light. The fonts are bundled with the app (SIL Open Font License) and fetched only once chosen. **Calendars**, at the end, lists the calendars your server reads, how many events each has, and when it was last read or why it couldn't be.

**Keys:** `Ctrl/Cmd+K` jumps to the task box, `/` to search, `Esc` clears search. `Alt+↑`/`Alt+↓` in a task's title in the journal moves it. With the border between the panels focused, `←`/`→` resize them (`Shift` for bigger steps).

**Phone:** the journal fills the screen. Tap the date (or the label's name) to slide the calendar and task list over it.

**Sync:** changes save locally, then push to the server and pull from it every 15 s, when you make an edit, and when the app regains focus. Offline edits merge when you reconnect. A small dot in the bottom-left shows the sync state; it only turns into words when you're offline or something is wrong.

## In the terminal

`almanac` is the app in a terminal, and a device of its own: it keeps a full copy of the data on the machine and syncs with your server as the browser does. It does what the web app does, by day and by label, with the keyboard (see [Running it](#in-the-terminal-1) to install it).

- **The screen:** on the left, search, the calendar, the open day's line, the task box and the task list; on the right, the day, with its events, its Due panel, the boxes pinned on earlier days and its journal, notes boxes in their labels' colors. Formulas show as Unicode where simple LaTeX allows (`\sigma = 0.3` as σ = 0.3), else as their LaTeX, and images are drawn in place in half-block characters, in any terminal with 256 colors or more. The calendar shows 20 weeks, more as you widen the pane. A day is ■, darker the more tasks you finished, ▣ if you wrote in its journal and · if it's still ahead, with a • after it if something is due. The bar along the bottom shows the sync state (a dot while all is well), the pane with focus, and the keys for what the cursor is on. `?` lists every key.
- **Keys:** `Tab` and `Shift+Tab` go between the calendar, the task list and the journal, and `j`/`k` (or the arrows) move the cursor. `h`/`l` go to the column on the left or right, the task list or the journal (in the calendar they go a week back or ahead, as the arrows do), and `J`/`K` to the next or previous box in it: in the journal the Due panel, each notes box and the lines between them; in the list each category, and from its top, the calendar. On a task, `x` checks it off, `r` renames it, `c` picks a category, `d` a due date ("fri", "nov 3"; empty removes it), `s` shows its subtasks, `A` adds one, `Enter` opens its day, and `D` deletes it, which `u` undoes. In the list, `Alt+↑`/`Alt+↓` move a task, or the category whose name the cursor is on. Anywhere, `a` or `Ctrl+K` adds a task, read and previewed as the web's task box reads it; `/` searches, `[`/`]` go a day back or ahead, `t` goes to today and `g` to a date, `<`/`>` resize the left pane, `Ctrl+S` syncs and `q` quits. On a notes box's label, `p` pins it to the days after, or unpins it.
- **By label:** `v` switches between the day and a label's notes: every box under the label, a section for each day, newest first, written in as in the day itself. From a box it goes to that box's label. `[`/`]` step through the labels and `L` picks one by name; `e` renames, recolors (the eight colors or any `#rrggbb`) or deletes the label, for every box with it; `Enter` on a date opens that day, and `+ Add to today` starts a box in today's journal. The calendar shows the label's days in its color.
- **Writing:** in the journal, `i` or `Enter` writes in the block under the cursor (in a task block, its title), `o` and `O` start a line below or above it, and `n` adds a notes box after it, under a label you pick or name. `Alt+↑`/`Alt+↓` move a block, into and out of boxes, or a whole box from its label; `D` deletes a block (a task block's task with it), and `u`/`Ctrl+R` undo and redo your own edits. While you write, the web editor's input rules apply: `[] ` starts a task, `#meeting ` a notes box under that label, `# `, `- `, `1. ` and `> ` a heading, a list or a quote, `$x^2$` and a line of `$$...$$` a formula, and `**bold**`, `*italic*`, `` `code` `` and `~~strike~~` those styles. `Enter` on an empty last line leaves a box, `Backspace` at a line's start joins it to the line above (after a formula, it turns the formula back into text to edit), and `Esc` stops writing. `Enter` on a box's label shows all its label's notes, changes its label, pins it, or removes it with or without its notes, and `Enter` on an image opens it in your image viewer (with no display, as over SSH, it's saved under `~/.cache/almanac/images` for you to open). A box pinned from an earlier day is written in where it shows, as on the web. Edits are saved as on the web, a second after you start, and what another device writes in the same day shows as you type, your cursor staying where it was.
- **From the shell:** `almanac add "submit abstract fri #paper"` adds a task, `almanac log "Asked about the new PSF."` adds a paragraph at the end of today's journal (or one per line of text piped to it), `almanac attach plot.png` adds an image there, made smaller as the web makes one dropped on a note, `almanac today` lists today's events and what's due today, overdue and finished (`--json` for a status line or a prompt), and `almanac sync` syncs and says how it went. While `almanac` is open in a terminal, these hand their work to it.
- **Two terminals:** a second `almanac` on the same machine opens read-only, and can write once the first one quits.
- **Settings:** `~/.config/almanac/config.json` keeps the server's address. It can also set `scheme` to one of the web's color schemes (`ocean`, `rose`, `plum`, `sand`, `graphite`) and `mode` to `light` or `dark`, for a terminal that doesn't report its background. The copy is in `~/.local/share/almanac/`, with the left pane's width and which tasks show their subtasks, both kept per machine.

It needs a terminal at least 40 × 16, and looks best with 256 colors or more. Below 100 columns it shows one pane at a time, as on a phone: the journal, and `Tab` brings the calendar and tasks over it.

## How it works

```
client/   React + Vite. A web worker owns a SQLite database (sqlite-wasm, saved to the
          browser's private file system) and runs the sync loop.
server/   Express + better-sqlite3. Stores the change log and serves the built client.
shared/   Schema, hybrid logical clock, merge, actions, queries and sync loop, used
          unchanged by the browser worker, the server, the terminal client and the tests.
tui/      Ink (React in the terminal) + better-sqlite3. The terminal client and its
          shell commands.
```

Every write becomes a change message `{hlc, tbl, row, col, value}`. It is applied locally and queued in an outbox. The server appends pushed changes to a numbered log and returns everything after the device's cursor. Fields merge per cell, and the change with the latest hybrid-logical-clock timestamp wins. Note bodies are Yjs documents whose updates merge automatically. Deletes are tombstones. See the design doc for the full rationale.

Tasks and journal days are rows in `items`. A task's category is a row in `props` (key `category`), so changing it is a single merge cell. The task list's order of categories is one more `props` row (`settings/categoryOrder`), a list of names, so the latest order set on any device wins. A task moved in the list has a position (`props` key `position`), a number ordering it among its category's tasks; moving one usually writes only its own, between its neighbours'. A journal day's id is `journal-YYYY-MM-DD`, so every device names the same day the same way. Task blocks in a body are kept in step with `embed` links from the day to the task.

A notes box is an element in the day's Yjs document (`noteBox`, holding the box's blocks), so its text merges, counts toward the calendar and is searched like the rest of the journal. The by-label view loads each day's document and binds a small editor to each box's element directly (its top node is named `noteBox` and has the box's attributes), so a box edited there is the same box the day shows. It stores only its label's id. Labels are rows in `items` with type `label`, and a label's color is a row in `props` (key `color`: a palette name, or `#rrggbb` for one picked by hand), so a rename or a new color is one merge cell that every box shows. The client turns a picked color into a shade per mode that reads at 4.5:1 (`client/src/lib/color.js`). A new label's id comes from its name (`label-papernotes`), so two devices that create the same label offline end up with one. A subtask is a task with a `subtask` link from its parent task; lists leave it out and count it on its parent instead (one whose parent was deleted by an older version, which doesn't delete subtasks, stands on its own). The editor keeps `label` links from a day to the labels on its boxes, the way it keeps `embed` links to its tasks, which is how the by-label view and the calendar find a label's days without opening every journal.

Pinning a box is a `props` row on its day (`<day id>/pin/<box id>`, key `pin`) holding `{ box, until }`, `until` being the day it was unpinned from; a day's page asks for the pins of earlier days that haven't been unpinned by then, loads those days' documents and edits their boxes in place, the way the by-label view does.

An image is a block in the body (`image`, with the file's id, its size and alt text taken from the file name) and a row in `files` (its type, and its bytes in base64), synced through the same change log. A file never changes, so it merges trivially. Pushes and pulls carry about 16 MB of values at a time, so a batch of images comes over in several rounds.

A file no note shows is removed after 30 days (`UNUSED_FILE_DAYS` in `server/src/store.js`). The server keeps every body merged, so it can tell which files they show, whatever version each device runs; every hour it notes the files none shows (in `unused_files`, its own table, not synced), and once one has gone 30 days unshown it sets the file's bytes to null, a change of its own that every device pulls, and drops the change that carried them from the log, so the bytes leave the server too and a new device never gets them. Deletes in a Yjs document are final, so a file comes back into use only when a note puts it in again (an undo, a paste, an image dragged to another place), and the 30 days leave time for that, and for a device that was offline to send its notes. A device that receives the removal while one of its notes shows the file writes the bytes again, after the removal, so the later write wins and the file is back for everyone. SQLite reuses the space freed; its file doesn't shrink without a `VACUUM`.

An image from the web is fetched by the server (`GET /api/image?url=`, in `server/src/images.js`), since few sites let another site's page read their images. It takes an image's own address, a page's (the image it shows when shared, its `og:image`, as Tenor's pages name their GIF), or a Giphy link, which Giphy's pages turn away a server's fetch for, so it's read as the GIF's id and fetched as Giphy's WebP of it, about a quarter the size. It won't fetch from loopback, private or link-local addresses, the tailnet's included, checked on every connection, so nobody who can reach the server can use it to reach what only the server can. The client then keeps the image as it keeps a file dropped on a note.

A calendar is read by the server (`server/src/calendars.js`), from the ICS links in `ALMANAC_CALENDARS`, when it starts and every 10 minutes after. It writes what it reads into the change log as changes of its own, as it does when it removes an image file: a row in `calendars` per link (its name, from the feed's `X-WR-CALNAME`, and how reading it last went), and a row in `events` per event UID. An event's `data` is a compact form of it (`shared/src/calendar.js`): its first start as a wall time in its IANA zone, its length, its RRULE (with UNTIL as the same kind of wall time), its EXDATEs and RDATEs, and the occurrences changed on their own (RECURRENCE-ID). Only what changed is written, each change taking the place of the cell's earlier one in the log, so reading a calendar every 10 minutes doesn't grow it; an event gone from the feed is deleted. The link, which lets anyone who has it read the calendar, stays on the server: a calendar's id is a hash of it, and errors name only its host. Each device works out when events happen, in its own time zone, from their data: a repeating event's occurrences come from ical.js, followed from its first one and kept in memory as later days are asked for.

**Leftovers from the earlier version:** that version had goals, projects, typed pages, saved views and a weekly review, and gave tasks a scheduled date as well as a due date. Their tables and columns stay in the schema so old changes still sync and replay, but the app no longer reads them (except `props`, which now holds categories and label colors; old tags there are ignored). Each device moves a task's scheduled date into its due date (an existing due date wins) at startup and after every sync. Old non-journal pages stay in the database but nothing opens them, and an old `[[link]]` in a journal shows as plain text.

**Schema upgrades:** when `SCHEMA_VERSION` goes up, each device and the server pull or replay the whole change log once. An older version silently skipped changes to tables it didn't know, and the replay recovers them. Re-applying known changes is a no-op.

**The terminal client** runs `shared/` on better-sqlite3, with its own node id, outbox and sync cursor. It edits a day's Yjs document directly, as TipTap does in the browser: each key is an insert or delete in the document, in the shapes TipTap's schema allows, so typing on two devices merges as it does between browsers. It saves as the web does, merging a second's edits into one `applyBodyUpdate` and keeping the day's links with `syncBodyLinks`, and keeps its cursor as a Yjs relative position, so it stays put as other devices' edits arrive. Its tests open what it writes in the web's own editor (the journal's TipTap extensions, under jsdom) and check the day shows as written and isn't rewritten. Images are read and drawn with sharp, loaded only once there's an image to draw or attach, which makes them smaller with the web's rules: one over 1.5 MB is resized to 2400 pixels at most and saved as WebP. It syncs as the browser worker does: 800 ms after an edit, every 15 s, and when the terminal regains focus. The hybrid logical clock lives in the process, so two processes writing one copy could stamp two changes alike. A running `almanac` therefore holds an exclusive SQLite lock on `almanac.lock` beside its copy and answers on `almanac.sock`, where `almanac add`, `log`, `attach` and `sync` send their work. Without a TUI running, those take the lock themselves. A second TUI opens the copy read-only, redraws when the first one writes (SQLite's `data_version`), and takes the lock once it's free.

## Running it

The toolchain needs Node 22.12 or newer. If your system Node is older, `scripts/node` runs any command in a `node:22-alpine` container with the repo mounted.

```sh
scripts/node npm install
scripts/node npm test          # unit and sync tests (Vitest)
scripts/dev                    # API on :8787, Vite dev server on http://127.0.0.1:5173
```

### Deploy with Docker

```sh
docker compose up -d --build   # serves on 127.0.0.1:8787, data in the almanac-data volume
tailscale serve --bg --https=8787 http://127.0.0.1:8787
```

Then open `https://<host>.<tailnet>.ts.net:8787` from any device on the tailnet. HTTPS is required: browsers only allow the private file system and service workers on secure origins. Plain `http://localhost` also counts as secure.

### Calendars

Each day can show its events from your Proton Calendar, or from any calendar with an ICS link. The server reads it, so the link stays there:

1. In Proton Calendar's settings, open the calendar and create a link under **Share with anyone**. **Full view** gives the events' titles, places and notes; **Limited view** gives only when you're busy.
2. Put the link in a `.env` file next to `docker-compose.yml` (git and Docker builds leave that file out). Separate several with spaces or commas; `webcal://` links work too.
   ```sh
   ALMANAC_CALENDARS='https://calendar.proton.me/api/calendar/v1/url/…/calendar.ics?CacheKey=…&PassphraseKey=…'
   ```
3. `docker compose up -d` to restart it with the link.

The server reads each calendar at once and then every 10 minutes, and the events reach each device with its next sync. **Settings → Calendars** shows how that went. Taking a link out takes its events off every device. Anyone with the link can read the calendar, so if it gets out, delete it in Proton Calendar and make another.

To add Almanac to the main `docker-compose.yml` instead, copy the `almanac` service (with its `environment`) and the `almanac-data` volume from this repo's compose file and set `build: ./almanac`.

### In the terminal

On each machine you want it on, with Node 22.12 or newer. `scripts/node` won't do here: the copy would live in its container and go when it does.

```sh
npm ci                   # in this repo
npm install -g ./tui     # puts almanac on your PATH, linked to this checkout
almanac --server https://<host>.<tailnet>.ts.net:8787
```

The first run checks that the server answers, keeps its address and pulls everything, as any new device does. After that, `almanac` on its own opens it. The command is a link to this checkout, so a pull and another `npm ci` update it.

### End-to-end tests

`scripts/test-server` starts a throwaway server on 127.0.0.1:8790 with an empty, in-memory data directory, serving the current client build. It leaves a real deployment alone.

```sh
scripts/node npm run build && scripts/test-server
scripts/e2e                                  # Chromium
scripts/e2e http://127.0.0.1:8790/ firefox   # or webkit
scripts/test-server stop
```

`e2e/e2e.py` uses two browser contexts as a laptop and a phone. It covers adding tasks with parsed dates and categories (and without a date), reordering categories and tasks (dragging, into another category too, and arrow keys, and seeing the order on the other device and after a reload), the Due panel (journal tasks due that day, adding a task due that day, and what else was finished), setting a category from a task's chip, removing a due date, completing tasks, undated `[]` tasks in the journal, moving task blocks (dragging, and `Alt`+arrows into and out of a notes box) and deleting one, clicking into a task's title in the list and the journal, equations (inline and on their own line, prices left alone, editing one, and finding one by search), images (dropping one where it lands, pasting a large one that is made smaller with the cursor below it, pasting two at once, dragging one, refusing other files, syncing them, and removing one), subtasks (from the list and the journal, their count, and syncing), notes boxes (starting one with `#label` or the button, tasks inside one taking its label as their category, moving one by its grip, pinning one to the days after it, writing in it there and unpinning it, leaving and removing one, renaming, recoloring (from the palette or any color) and deleting a label), the journal by label (the default label, sections newest first, editing a box and a task there and seeing it on the day, recoloring a label from its page, starting today's box, removing one, the calendar highlight, and the phone layout), changing a date from its chip, the calendar (shading, due dots, clicking and arrow keys), search, the keyboard shortcuts, resizing the panels (mouse, keys, reset, and the width after a reload), Settings (mode, color scheme and font, through a reload, and not on the other device; every font loads), the phone layout, live sync, offline edits to the same paragraph merging, and reload persistence.

Screenshots land in `e2e/shots/`.

### Android app

An APK to install on an Android phone. It's the same app in a Capacitor shell that carries its own copy of the page, so it opens without a connection, keeps its data on the phone, and syncs with your server whenever it can reach it: over Tailscale, whenever the Tailscale app is connected.

```sh
scripts/android/build   # build/almanac.apk, syncing with https://<this machine's tailnet name>:8787
SERVER_URL=https://computer.your-tailnet.ts.net:8787 scripts/android/build   # another address
```

The build runs in Docker. The first one downloads the Android SDK and Gradle (a few GB, cached after). The address is the app's default; **Settings → Sync** changes it, checking that the server answers first.

To install, copy `build/almanac.apk` to the phone, for example with Taildrop (`tailscale file cp build/almanac.apk <phone>:`), open it there, and let that app install unknown apps when Android asks. To update, build again and install over it; the app keeps its data.

**The Today widget** goes on the home screen from **Settings → Home screen** in the app, or from the home screen's own list of widgets. It shows what's due today and what's overdue, as the Due panel does: the box beside a task checks it off, the task opens its day in the app, and **+** opens the task box. The notes live inside the app, out of the widget's reach, so the app gives it a copy of the open tasks due within a week whenever they change while it's open. The widget works out what's due from the phone's date, so it stays right as days pass. A task checked off in the widget shows as done there at once, and is checked off in the app, and synced, the next time Almanac opens.

- **Keep a copy of `android-signing/`.** The first build makes the key that signs the app there (it's not in git). Android installs an update only if it's signed with the same key; without it, you'd uninstall the app and sync it again from the server.
- **The server must be up to date** for the app to sync: it lets the app's pages (`https://localhost`, inside the app) call its API, and no other site. `ALMANAC_APP_ORIGINS` changes that list.
- **Testing:** `scripts/android/test` builds a debug APK that syncs with the throwaway test server, runs it in an Android 15 emulator (needs `/dev/kvm`), and drives it with `e2e/android.mjs` next to a laptop in Chromium: sync both ways, the server address in Settings, a restart with the server out of reach (the data is still there, edits queue and go through once it's back), and the Today widget on the home screen (added from Settings, a task checked off in it reaching the laptop, its + opening the task box). `scripts/android/test stop` stops the emulator.
- `scripts/android/icons` redraws the icon, a calendar grid on the accent green.

### Upgrading a running deployment

```sh
docker compose up -d --build
```

Reload the app on each device. Each one replays the change log once after a schema upgrade, so the first sync takes a little longer. A tab still running an older version stops editing a day whose journal has something it doesn't know, such as a notes box, an equation or an image: the journal stays empty and ignores typing (nothing is lost) until you reload. It also shows a label with a hand-picked color in blue, and subtasks as tasks of their own.

## Known limitations

- **One tab at a time.** The browser storage backend locks the database to a single tab. A second tab falls back to memory and says so under the task list.
- **The web app doesn't load offline.** Data works offline once it's open, but there is no service worker, so the page itself needs the server to load. The Android app doesn't have this limit.
- **Untested on iOS Safari.** It worked in Chromium and Firefox. Playwright's Linux WebKit has no `navigator.storage`, so there it runs in memory-only mode. Real Safari supports the needed APIs, but check it on your phone.
- **Changes from other devices arrive by polling** (every 15 s, or on focus), not by push.
- **The Android widget shows the phone's copy as of when Almanac was last open.** It can't sync on its own, so a task added on another device shows in it once the app has opened and synced, and one checked off in it reaches other devices once the app opens.
- **Deleting a task block along with other text keeps the task.** It stays in the list on the left; the block's trash can deletes it.
- **Dragging tasks and notes boxes needs a mouse.** Touch screens don't get their grips. (A category's grip does work by touch.)
- **Moving a notes box doesn't merge with offline edits to it.** Yjs has no move, so a moved box is saved as taken out in one place and written anew in the other. Anything another device typed into that box while offline, before the two synced, can be lost.
- **Adding images on a phone.** Phones don't drag files into apps, so there an image goes in only by pasting it. There's no button to pick one yet.
- **Removed images stay in the database.** Taking an image out of a note keeps its file, on the server and on each device, as with every change in the log.
- **The calendar covers the past year and the next four weeks.** Older days are reachable with the ‹ › buttons or search.
- **Calendars are read-only, and up to 10 minutes behind.** Events are changed in Proton Calendar, and Almanac reads them every 10 minutes (Proton can take a while longer to update a shared link). They aren't on the calendar grid or found by search, and the terminal shows an event's time, title and place but not its notes. A repeating event in a time zone without an IANA name (an Outlook one, say) can be an hour off after the clocks change.
- **Deleted tasks leave no history.** A finished task you delete no longer counts on the calendar.
- **Unsynced typing can be lost if a tab closes abruptly.** Note bodies save after 1 s of quiet, so up to that much typing is at risk.
- **New devices replay the whole change log.** There is no snapshot or compaction yet.
- **The terminal draws images in half-block characters**, two pixels to a cell, not with the kitty, iTerm2 or sixel graphics protocols, which don't mix with how it redraws the screen. Formulas beyond simple LaTeX (matrices, alignments) show as their source. A block of a kind it doesn't know is left as it is. It has no mouse support.
- **A harmless console warning** ("TextSelection endpoint not pointing into a node with inline content") comes from TipTap's Yjs binding when you leave a day or a label's page, or open a day that starts with a notes box.

## License

AGPL-3.0, the same as parallax-presentations.
