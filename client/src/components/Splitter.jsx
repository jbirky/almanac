import { useRef } from 'react';

export const PANEL = { min: 280, initial: 420, step: 16 };
// The journal keeps at least this much room.
const MAIN_MIN = 420;

const maxWidth = () => Math.max(PANEL.min, innerWidth - MAIN_MIN);
const clampWidth = (w) => Math.round(Math.min(Math.max(w, PANEL.min), maxWidth()));

// The border between the left panel and the journal, dragged to resize the panel. Arrow keys
// move it too (Shift for bigger steps), and a double-click puts it back. `onChange` gets each
// new width; `onCommit` the one to keep.
export function Splitter({ width, onChange, onCommit }) {
  const drag = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Start from the panel's width as shown (it comes just before), which can be less than the
    // one asked for in a narrow window.
    const shown = e.currentTarget.previousElementSibling.getBoundingClientRect().width;
    drag.current = { x: e.clientX, width: shown, last: width };
    document.documentElement.classList.add('resizing');
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    drag.current.last = clampWidth(drag.current.width + e.clientX - drag.current.x);
    onChange(drag.current.last);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    onCommit(drag.current.last);
    drag.current = null;
    document.documentElement.classList.remove('resizing');
  };
  const onKeyDown = (e) => {
    const step = (e.shiftKey ? 4 : 1) * PANEL.step;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: PANEL.min, End: maxWidth() }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onCommit(clampWidth(next));
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the left panel"
      aria-valuenow={width}
      aria-valuemin={PANEL.min}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(PANEL.initial)}
    />
  );
}
