import { useEffect, useState } from 'react';

// A short message about something that just happened, such as an image that couldn't be
// added, shown at the bottom of the page for a few seconds.
const SHOW_MS = 6000;
const listeners = new Set();

export function notify(message) {
  for (const listener of listeners) listener(message);
}

export function Notices() {
  const [message, setMessage] = useState(null);
  useEffect(() => {
    let timer = null;
    const show = (text) => {
      setMessage(text);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), SHOW_MS);
    };
    listeners.add(show);
    return () => {
      listeners.delete(show);
      clearTimeout(timer);
    };
  }, []);
  // The live region stays on the page, so a screen reader hears each message as it comes.
  return (
    <div className="notices" role="status">
      {message && (
        <p className="notice">
          {message}
          <button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>
            ×
          </button>
        </p>
      )}
    </div>
  );
}
