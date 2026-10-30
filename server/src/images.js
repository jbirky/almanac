import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Images on the web, fetched for a note pasted or dropped from a web page: an image's own
// address, or a page that shows one. Few sites let another site's page read their images, so the
// client asks for them here and keeps what comes back as it keeps an image file dropped on a note.

export class FetchError extends Error {}

// The client makes a large image smaller; a GIF over 5 MB it turns away itself.
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;
const HEADERS = { 'User-Agent': 'Almanac (fetching an image for a note)', Accept: 'image/*,*/*;q=0.8' };

// Addresses on this machine or its networks (loopback, the LAN, the tailnet, link-local) aren't
// fetched, so nobody who can reach this server can use it to reach what only it can.
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]) {
  PRIVATE.addSubnet(address, prefix, 'ipv4');
}
// An IPv4 address written as IPv6 (::ffff:127.0.0.1) is checked against the ranges above, and
// a range of those here would take in every IPv4 address.
for (const [address, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  PRIVATE.addSubnet(address, prefix, 'ipv6');
}
export const isPrivate = (address) => PRIVATE.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');

// dns.lookup, leaving out private addresses. It runs for every connection, redirects included,
// so a name can't point somewhere else between being checked and being fetched.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const usable = addresses.filter((a) => !isPrivate(a.address));
    if (!usable.length) return callback(new FetchError(`${hostname} is on a private network, so it isn't fetched.`));
    if (options.all) callback(null, usable);
    else callback(null, usable[0].address, usable[0].family);
  });
}

// The image at `address`, or the one a page there shows, as { bytes, type, name }; a FetchError
// says why not. `allowPrivate` lets tests fetch from this machine.
export async function fetchImage(address, { allowPrivate = false } = {}) {
  let url = webUrl(address);
  if (!url) throw new FetchError("That isn't a web address.");
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let name = null;
  let fromPage = false;
  for (let redirects = 0; ; ) {
    const giphy = giphyMedia(url);
    if (giphy) ({ url, name } = giphy);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(host) && isPrivate(host)) throw new FetchError(`${host} is on a private network, so it isn't fetched.`);

    const res = await request(url, { lookup: allowPrivate ? undefined : publicLookup, signal });
    const location = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume();
      if (++redirects > MAX_REDIRECTS) throw new FetchError(`${url.host} sent it on too many times.`);
      const next = webUrl(location, url);
      if (!next) throw new FetchError(`${url.host} sent it somewhere that isn't a web address.`);
      url = next;
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new FetchError(`${url.host} answered ${res.statusCode}${res.statusMessage ? ` (${res.statusMessage})` : ''}.`);
    }
    const bytes = await readAll(res, url, signal);
    const header = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const type = sniff(bytes) ?? (header.startsWith('image/') ? header : null);
    if (type) return { bytes, type, name: name ?? fileName(url, type) };
    // A page (once): the image it shows when it's shared, as Tenor's pages name their GIF.
    const shown = !fromPage && header === 'text/html' ? pageImage(bytes.toString('utf8'), url) : null;
    if (!shown) throw new FetchError(`There's no image at ${url.host}${url.pathname === '/' ? '' : url.pathname}.`);
    url = shown;
    fromPage = true;
  }
}

function webUrl(text, base) {
  try {
    const url = new URL(text, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// A Giphy page (giphy.com/gifs/cat-funny-JIX9t2j0ZTN9S) turns away a fetch that isn't a
// browser's, but its address names the GIF. Giphy's animated WebP of it is a quarter the size.
export function giphyMedia(url) {
  if (!/^(www\.)?giphy\.com$/.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:gifs|stickers|embed)\/(?:([\w-]*)-)?([A-Za-z0-9]+)(?:\/|$)/);
  if (!match) return null;
  return { url: new URL(`https://media.giphy.com/media/${match[2]}/giphy.webp`), name: `${match[1] || 'giphy'}.webp` };
}

function request(url, { lookup, signal }) {
  return new Promise((resolve, reject) => {
    const get = url.protocol === 'https:' ? https.get : http.get;
    const req = get(url, { headers: HEADERS, lookup, signal }, resolve);
    req.on('error', (err) => reject(failure(err, url, signal)));
  });
}

async function readAll(res, url, signal) {
  if (Number(res.headers['content-length']) > MAX_BYTES) {
    res.destroy();
    throw new FetchError(`It's over ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        res.destroy();
        throw new FetchError(`It's over ${MAX_BYTES / 1024 / 1024} MB.`);
      }
      chunks.push(chunk);
    }
  } catch (err) {
    throw failure(err, url, signal);
  }
  return Buffer.concat(chunks);
}

function failure(err, url, signal) {
  if (err instanceof FetchError) return err;
  if (signal.aborted) return new FetchError(`${url.host} took too long to answer.`);
  return new FetchError(`Couldn't reach ${url.host}.`);
}

// What kind of image `bytes` are, by their first bytes rather than what the server says.
function sniff(bytes) {
  const text = (from, to) => bytes.subarray(from, to).toString('latin1');
  if (text(0, 6) === 'GIF87a' || text(0, 6) === 'GIF89a') return 'image/gif';
  if (text(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(4, 8) === 'ftyp' && /^avi[fs]$/.test(text(8, 12))) return 'image/avif';
  return null;
}

const EXTENSIONS = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };

// The image's file name, for its alt text: the last part of its address.
function fileName(url, type) {
  let last = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // Left as it is.
  }
  if (/\.\w+$/.test(last)) return last;
  return `${last || 'image'}.${EXTENSIONS[type] ?? 'img'}`;
}

// The image a page shows when it's shared: its og:image (or twitter:image).
function pageImage(html, base) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attribute(tag, 'property') ?? attribute(tag, 'name');
    if (!/^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/i.test(key ?? '')) continue;
    const content = attribute(tag, 'content');
    const url = content && webUrl(decodeEntities(content.trim()), base);
    if (url) return url;
  }
  return null;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decodeEntities = (text) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  });
