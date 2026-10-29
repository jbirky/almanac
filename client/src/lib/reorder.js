// Dragging something in a list by its grip, with a mouse or by touch. The places it can go are
// lines across the list, each at a height `y` (in the window, as the drag starts); the place
// nearest the pointer is reported as it moves, and on release is where the thing goes. Near the
// top or bottom of the scrolling list, the list scrolls. Escape calls the drag off.
const EDGE = 40;
const STEP = 10;

export function dragToReorder(event, { scroller, places, onPlace, onDrop }) {
  if (event.button !== 0 || !places.length) return;
  event.preventDefault();
  const grip = event.currentTarget;
  grip.setPointerCapture(event.pointerId);
  // Heights in the list's content, which scrolling doesn't change.
  const offset = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const lines = places.map((place) => ({ place, y: place.y - offset }));
  let pointerY = event.clientY;
  let current = null;
  let frame = null;

  const update = () => {
    const y = pointerY - scroller.getBoundingClientRect().top + scroller.scrollTop;
    let nearest = lines[0];
    for (const line of lines) if (Math.abs(line.y - y) < Math.abs(nearest.y - y)) nearest = line;
    if (nearest.place !== current) {
      current = nearest.place;
      onPlace(current);
    }
  };
  const scroll = () => {
    const box = scroller.getBoundingClientRect();
    const step = pointerY < box.top + EDGE ? -STEP : pointerY > box.bottom - EDGE ? STEP : 0;
    if (step) {
      scroller.scrollTop += step;
      update();
    }
    frame = requestAnimationFrame(scroll);
  };
  const onMove = (e) => {
    pointerY = e.clientY;
    update();
  };
  const finish = (drop) => {
    cancelAnimationFrame(frame);
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onCancel);
    removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('reordering');
    onPlace(null);
    if (drop && current) onDrop(current);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onCancel);
  addEventListener('keydown', onKey, true);
  document.documentElement.classList.add('reordering');
  update();
  frame = requestAnimationFrame(scroll);
}
