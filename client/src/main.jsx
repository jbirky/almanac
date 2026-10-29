import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
// The fonts Settings offers. The browser fetches a font's files only once a page uses it.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource-variable/ibm-plex-sans/wght-italic.css';
import '@fontsource-variable/nunito/wght.css';
import '@fontsource-variable/nunito/wght-italic.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css';
import '@fontsource-variable/shantell-sans/wght.css';
import '@fontsource-variable/shantell-sans/wght-italic.css';
import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
// These two change their letters with the size (optical sizes), for small text and headings.
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
// Merriweather's optical-size file has a table Firefox rejects (and logs); this one is fine.
import '@fontsource-variable/merriweather/wght.css';
import '@fontsource-variable/merriweather/wght-italic.css';
import '@fontsource-variable/eb-garamond/wght.css';
import '@fontsource-variable/eb-garamond/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/400-italic.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/courier-prime/700-italic.css';
import 'katex/dist/katex.min.css';
import './styles.css';

// A file dropped anywhere but in a note would open in place of the app.
addEventListener('dragover', (e) => {
  if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files') || e.target.isContentEditable) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});

// Ask the browser not to evict local data under storage pressure (best effort; the server
// keeps a full copy either way).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
