import { useState } from 'react';
import { normalizeServerUrl } from '@almanac/shared';
import { setServer, syncNow } from '../lib/db.js';
import { useQuery } from '../lib/hooks.js';
import { IS_APP, checkServer, serverUrl } from '../lib/server.js';
import { pinWidget } from '../lib/widget.js';
import { FONTS, FONT_KINDS, MODES, THEMES, setSetting, useSettings } from '../lib/settings.js';

// A few calendar days, for each color scheme's preview.
const PREVIEW_CELLS = [1, 3, 0, 2, 4, 1, 0, 3, 2, 4, 1, 2];

// Appearance: light or dark, a color scheme, and a font. Each applies at once. In the Android
// app, also the server it syncs with. Then the calendars the server reads, the same everywhere.
export function SettingsPage({ views }) {
  const settings = useSettings();
  return (
    <article className="day-page settings-page">
      <header className="day-header">
        <div className="day-header-top">
          <p className="kicker"> </p>
          {views}
        </div>
        <h1>Settings</h1>
      </header>

      <section className="settings-section" aria-labelledby="settings-colors">
        <h2 id="settings-colors">Colors</h2>
        <fieldset className="mode-options">
          <legend>Light or dark</legend>
          {MODES.map((m) => (
            <label key={m.id}>
              <input
                type="radio"
                name="mode"
                value={m.id}
                checked={settings.mode === m.id}
                onChange={() => setSetting('mode', m.id)}
              />
              {m.name}
            </label>
          ))}
        </fieldset>
        <fieldset className="theme-options">
          <legend>Color scheme</legend>
          {THEMES.map((t) => (
            // Each card takes its scheme's colors, in the current mode.
            <label key={t.id} className="theme-option" data-theme={t.id}>
              <input
                type="radio"
                name="theme"
                value={t.id}
                checked={settings.theme === t.id}
                onChange={() => setSetting('theme', t.id)}
              />
              <span className="theme-preview" aria-hidden="true">
                <span className="theme-preview-panel">
                  {PREVIEW_CELLS.map((level, i) => (
                    <span key={i} className={`theme-preview-cell l${level}`} />
                  ))}
                </span>
                <span className="theme-preview-page">
                  <span className="theme-preview-kicker" />
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line short" />
                </span>
              </span>
              <span className="theme-name">{t.name}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="settings-section" aria-labelledby="settings-font">
        <h2 id="settings-font">Font</h2>
        {/* One set of choices, in groups by kind. */}
        {FONT_KINDS.map((kind) => (
          <fieldset key={kind} className="font-options">
            <legend>{kind}</legend>
            {FONTS.filter((f) => f.kind === kind).map((f) => (
              // Each card shows its font.
              <label key={f.id} className="font-option" data-font={f.id}>
                <input
                  type="radio"
                  name="font"
                  value={f.id}
                  checked={settings.font === f.id}
                  onChange={() => setSetting('font', f.id)}
                  aria-label={f.name}
                  aria-describedby={`font-note-${f.id}`}
                />
                <span className="font-name" aria-hidden="true">
                  {f.name}
                </span>
                <span className="font-note" id={`font-note-${f.id}`}>
                  {f.note}
                </span>
                <span className="font-sample" aria-hidden="true">
                  Discussed priors for the fits; rerun 3 of 10 by Friday.
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      {IS_APP && <ServerSettings />}
      {IS_APP && <WidgetSettings />}

      <p className="subtle settings-note">
        These are saved {IS_APP ? 'in this app' : 'in this browser'}, so each of your devices keeps its own.
      </p>

      <CalendarSettings />
    </article>
  );
}

// "just now", "5 minutes ago", "3 hours ago", or the day.
function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 24 * 60) return format.format(-Math.round(minutes / 60), 'hour');
  return `on ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// The calendars the server reads (server/src/calendars.js), whose events each day shows, and how
// reading each went. They're set on the server, so this only shows them.
function CalendarSettings() {
  const calendars = useQuery('calendars', [], ['calendars', 'events']);
  if (!calendars) return null;
  return (
    <section className="settings-section calendar-settings" aria-labelledby="settings-calendars">
      <h2 id="settings-calendars">Calendars</h2>
      {calendars.length > 0 && (
        <ul className="calendar-list">
          {calendars.map((c) => (
            <li key={c.id}>
              <span className="calendar-name">{c.name}</span>
              <span className="subtle">
                {' '}
                · {c.events === 1 ? '1 event' : `${c.events} events`}
                {c.checked_at && ` · ${c.error ? 'tried' : 'read'} ${ago(c.checked_at)}`}
              </span>
              {c.error && <p className="server-error">{c.error}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="subtle">
        {calendars.length > 0
          ? 'Each day shows its events from these, which your server reads every 10 minutes. '
          : 'Each day can show its events from your Proton Calendar. '}
        To add a calendar, share it with a link in Proton Calendar’s settings (full view, for the events’ titles),
        and add that link to <code>ALMANAC_CALENDARS</code> on your server. Any other calendar’s ICS link works too.
      </p>
    </section>
  );
}

// The Today widget, added to the home screen from here or from the home screen's own list of
// widgets.
function WidgetSettings() {
  const [state, setState] = useState(null);
  const add = async () => setState((await pinWidget()) ? 'asked' : 'unable');
  return (
    <section className="settings-section widget-settings" aria-labelledby="settings-widget">
      <h2 id="settings-widget">Home screen</h2>
      <p className="subtle">
        The Today widget shows what’s due today and overdue, to check off there. It shows what this phone had the
        last time Almanac was open; what you check off in it is checked off here, and synced, the next time you
        open Almanac.
      </p>
      <button type="button" className="widget-add" onClick={add}>
        Add the Today widget
      </button>
      {state === 'unable' && (
        <p className="server-error" role="status">
          This home screen can’t add it from here. Hold down on an empty part of the home screen, choose Widgets,
          and find Almanac.
        </p>
      )}
    </section>
  );
}

// The server the Android app syncs with, checked before it's saved.
function ServerSettings() {
  const [saved, setSaved] = useState(serverUrl);
  const [text, setText] = useState(saved);
  const [state, setState] = useState(null); // { checking } | { ok, message }

  const save = async (e) => {
    e.preventDefault();
    const url = normalizeServerUrl(text);
    if (!url) {
      setState({ ok: false, message: 'Enter an https address, such as https://computer.your-tailnet.ts.net:8787.' });
      return;
    }
    setText(url);
    setState({ checking: true });
    const result = await checkServer(url);
    if (!result.ok) return setState(result);
    setServer(url);
    setSaved(url);
    syncNow();
    setState({ ok: true, message: 'Connected. Syncing with it now.' });
  };

  return (
    <section className="settings-section" aria-labelledby="settings-sync">
      <h2 id="settings-sync">Sync</h2>
      {/* Checked here, not by the browser, so "host:8787" without https:// is fine. */}
      <form className="server-form" onSubmit={save} noValidate>
        <label htmlFor="server-url">Server address</label>
        <div className="server-row">
          <input
            id="server-url"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={text}
            placeholder="https://computer.your-tailnet.ts.net:8787"
            onChange={(e) => {
              setText(e.target.value);
              setState(null);
            }}
          />
          <button type="submit" disabled={state?.checking}>
            {state?.checking ? 'Checking…' : text.trim() === saved ? 'Check' : 'Save'}
          </button>
        </div>
        {state && !state.checking && (
          <p className={state.ok ? 'server-ok' : 'server-error'} role="status">
            {state.message}
          </p>
        )}
        <p className="subtle">
          The app keeps everything on this phone and syncs with this server whenever it can reach it. Over Tailscale,
          that's when the Tailscale app is connected.
        </p>
      </form>
    </section>
  );
}
