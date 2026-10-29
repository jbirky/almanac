import { GearIcon } from './icons.jsx';

// Shows the journal one day at a time, or one label at a time across days, or the settings.
// Each journal view returns to the day or label last shown in it.
export function ViewSwitch({ view, dayHref, labelHref }) {
  return (
    <nav className="view-switch" aria-label="Views">
      <a href={dayHref} aria-current={view === 'day' ? 'page' : undefined}>
        By day
      </a>
      <a href={labelHref} aria-current={view === 'label' ? 'page' : undefined}>
        By label
      </a>
      <a href="#/settings" aria-current={view === 'settings' ? 'page' : undefined} aria-label="Settings" title="Settings">
        <GearIcon />
      </a>
    </nav>
  );
}
