import { useEffect, useState } from 'react';
import { action, onChange, query } from './db.js';

// Images in notes are kept, synced and shown from the database (the files table), so every
// device has them offline. One that is already small is kept as it is, so a plot or a
// screenshot stays sharp; a larger one is made smaller first.
const KEEP_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const KEEP_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2400;
const MAX_BYTES = 5 * 1024 * 1024;

export class ImageError extends Error {}

// A file to put in a note as { blob, width, height }, or an ImageError saying why not.
export async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError(`Couldn't add “${file.name}”: this browser can't read that kind of image.`);
  }
  try {
    const { width, height } = bitmap;
    // A GIF would lose its animation, so it's kept whole or not at all.
    const keep = KEEP_TYPES.has(file.type) && (file.size <= KEEP_BYTES || file.type === 'image/gif');
    if (keep) {
      if (file.size > MAX_BYTES) throw new ImageError(`Couldn't add “${file.name}”: it's over 5 MB.`);
      return { blob: file, width, height };
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
    for (const quality of [0.86, 0.7]) {
      const blob = await encode(bitmap, size, quality);
      if (blob.size <= MAX_BYTES) return { blob, ...size };
    }
    throw new ImageError(`Couldn't add “${file.name}”: it's too large, even made smaller.`);
  } finally {
    bitmap.close();
  }
}

// WebP keeps transparency; a browser that can't write it (Safari) gives JPEG on white.
async function encode(bitmap, { width, height }, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, width, height);
  const webp = await toBlob(canvas, 'image/webp', quality);
  if (webp?.type === 'image/webp') return webp;
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  return toBlob(canvas, 'image/jpeg', quality);
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Keeps a prepared image under `id`, ready to show here at once.
export async function saveImage(id, { blob }) {
  urls.set(id, URL.createObjectURL(blob));
  await action.addFile(id, blob.type, new Uint8Array(await blob.arrayBuffer()));
}

// Files never change, so each one's address is made once and kept for the page's life.
const urls = new Map();

// The address of image `id` for an <img>, or null until it has synced to this device.
export function useImageUrl(id) {
  const [url, setUrl] = useState(() => urls.get(id) ?? null);
  useEffect(() => {
    if (!id) return undefined;
    if (urls.has(id)) {
      setUrl(urls.get(id));
      return undefined;
    }
    let alive = true;
    const load = () =>
      query.file(id).then((file) => {
        if (!alive || !file) return;
        if (!urls.has(id)) urls.set(id, URL.createObjectURL(new Blob([file.bytes], { type: file.type })));
        setUrl(urls.get(id));
        off();
      });
    const off = onChange((change) => change.tables.includes('files') && change.rows.includes(id) && load());
    load();
    return () => {
      alive = false;
      off();
    };
  }, [id]);
  return url;
}
