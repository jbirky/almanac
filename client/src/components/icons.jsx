// Small line icons, drawn in the text color.

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
    </svg>
  );
}

// Six dots: something to grab and drag.
export function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
    </svg>
  );
}

// A thumbtack: a notes box pinned to the days after its own.
export function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 1.75l4.75 4.75-1.5.5-2.5 2.5-.25 3-1 1-6.5-6.5 1-1 3-.25 2.5-2.5.5-1.5zM5.25 10.75L1.75 14.25" />
    </svg>
  );
}

// For empty chips, which show on hover: add a category, a due date, subtasks.
export function TagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 2.5h5.5l6.5 6.5-5 5L2.5 7.5V2.5z" />
      <circle cx="5.25" cy="5.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}

export function SubtasksIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4l1.5 1.5L6 3M8.5 4.5H14M2 10.5l1.5 1.5L6 9.5M8.5 11H14" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.9 1.5h2.2l.35 1.8 1.25.7 1.75-.6 1.1 1.9-1.4 1.2v1.5l1.4 1.2-1.1 1.9-1.75-.6-1.25.7-.35 1.8H6.9l-.35-1.8-1.25-.7-1.75.6-1.1-1.9 1.4-1.2V6.5L2.45 5.3l1.1-1.9 1.75.6 1.25-.7z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}
