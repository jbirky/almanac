// Images from the web, for notes: the address of one in pasted or dropped data, which the server
// fetches (server/src/images.js), and whether a WebP moves.

// Links that name an image file, or a GIF's page on Giphy or Tenor.
const IMAGE_FILE = /\.(gif|png|jpe?g|webp|avif)$/i;
const GIF_PAGE = /^https?:\/\/((www\.)?giphy\.com\/(gifs|stickers|embed)\/|(www\.)?tenor\.com\/([\w-]+\/)?view\/|gph\.is\/)/i;

// The web address of the one image that pasted or dropped `data` (a DataTransfer) holds, if
// that's all it holds: a picture copied or dragged from a web page (its <img>, whatever its
// address), or a link to an image or to a GIF on Giphy or Tenor. Null for anything else, a link
// to another page included.
export function imageUrlIn(data) {
  const html = data.getData('text/html');
  if (html) {
    const { body } = new DOMParser().parseFromString(html, 'text/html');
    const images = body.querySelectorAll('img');
    if (images.length === 1 && !body.textContent.trim()) {
      const url = webUrl(images[0].getAttribute('src'));
      if (url) return url.href;
    }
  }
  const uris = data
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'));
  const url = webUrl(uris.length === 1 ? uris[0].trim() : data.getData('text/plain').trim());
  return url && (IMAGE_FILE.test(url.pathname) || GIF_PAGE.test(url.href)) ? url.href : null;
}

function webUrl(text) {
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Whether WebP `bytes` (its first 21 at least) are animated: the flag in its VP8X header.
export function isAnimatedWebp(bytes) {
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP' && text(12, 16) === 'VP8X' && (bytes[20] & 0x02) !== 0;
}
