import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Images in notes, in the terminal: drawn in place with half-block characters (each cell a pixel
// above and one below, in the terminal's own colors, so they show in any terminal with 256 colors
// or more, over SSH and in tmux too), opened in the system's image viewer, and made ready to put
// in a note as the web makes them (client/src/lib/images.js). sharp decodes and encodes them; it's
// loaded the first time an image is, so the TUI starts without it.

let loaded = null;
const sharp = async () => (loaded ??= (await import('sharp')).default);

export class ImageError extends Error {}

// The web's rules: a small image of a kind every browser shows is kept as it is, so a plot or a
// screenshot stays sharp; a larger one is made smaller, as WebP; a GIF is kept whole or not at all.
const KEEP_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const KEEP_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2400;
const MAX_BYTES = 5 * 1024 * 1024;
const FORMATS = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };

// An image's size as shown: EXIF orientation 5 to 8 turns it on its side.
const shownSize = (meta) => (meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height]);

// An image file to put in a note, as { bytes, type, width, height, smaller }, or an ImageError
// saying why not.
export async function prepareImage(bytes, name) {
  const s = await sharp();
  let meta;
  try {
    meta = await s(bytes).metadata();
  } catch {
    throw new ImageError(`Couldn’t add “${name}”: it isn’t an image this can read.`);
  }
  const type = meta.format === 'heif' ? (meta.compression === 'av1' ? 'image/avif' : null) : FORMATS[meta.format];
  if (KEEP_TYPES.has(type) && (bytes.length <= KEEP_BYTES || type === 'image/gif')) {
    if (bytes.length > MAX_BYTES) throw new ImageError(`Couldn’t add “${name}”: it’s over 5 MB.`);
    const [width, height] = shownSize(meta);
    return { bytes, type, width, height, smaller: false };
  }
  for (const quality of [86, 70]) {
    const { data, info } = await s(bytes)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= MAX_BYTES) return { bytes: data, type: 'image/webp', width: info.width, height: info.height, smaller: true };
  }
  throw new ImageError(`Couldn’t add “${name}”: it’s too large, even made smaller.`);
}

// "light curve fit.png" -> "light curve fit". A pasted screenshot is just "image".
export function altText(name) {
  const stem = name.replace(/\.[^.]+$/, '').trim();
  return stem.toLowerCase() === 'image' ? '' : stem;
}

// The nearest of the 256 colors to [r, g, b]: the 6×6×6 cube or the grays.
function ansi256([r, g, b]) {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const c = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}

// An image as lines of half-block characters at most `cols` wide and `rows` high, its proportions
// kept and never bigger than its pixels; transparency shows `background` ("#rrggbb"). `level` is the
// terminal's color depth (chalk's): millions of colors, or 256. Each line is a string with its
// colors in it, ending with the terminal's own.
export async function imageLines(bytes, { cols, rows, background, level = 3 }) {
  const s = await sharp();
  const meta = await s(bytes).metadata();
  const [w, h] = shownSize(meta);
  const scale = Math.min(1, cols / w, (rows * 2) / h);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(2, Math.round(h * scale));
  const { data } = await s(bytes, { animated: false })
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .flatten({ background })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x, y) => (y < height ? [data[(y * width + x) * 3], data[(y * width + x) * 3 + 1], data[(y * width + x) * 3 + 2]] : null);
  const back = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  const fg = (c) => (level >= 3 ? `\x1b[38;2;${c.join(';')}m` : `\x1b[38;5;${ansi256(c)}m`);
  const bg = (c) => (level >= 3 ? `\x1b[48;2;${c.join(';')}m` : `\x1b[48;5;${ansi256(c)}m`);
  const lines = [];
  for (let y = 0; y < height; y += 2) {
    let line = '';
    let last = '';
    for (let x = 0; x < width; x++) {
      const code = fg(at(x, y)) + bg(at(x, y + 1) ?? back);
      line += (code === last ? '' : code) + '▀';
      last = code;
    }
    lines.push(`${line}\x1b[39m\x1b[49m`);
  }
  return lines;
}

// Opens image `file` ({ bytes, type }) in the system's image viewer, saving it under `dir` first.
// Returns where it's saved and whether a viewer was asked to open it (not over SSH, with no display).
export function openImage(file, id, dir) {
  const saved = path.join(dir, `${id}.${EXTENSIONS[file.type] ?? 'img'}`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(saved)) fs.writeFileSync(saved, file.bytes);
  const opener = { darwin: 'open', linux: 'xdg-open', freebsd: 'xdg-open', openbsd: 'xdg-open' }[process.platform];
  const display = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
  if (!opener || !display) return { saved, opened: false };
  const child = spawn(opener, [saved], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return { saved, opened: true };
}
