import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import sharp from 'sharp';
import { BODY_FIELD, journalId } from '@almanac/shared';
import { attachFiles, fileSize } from '../src/commands.js';
import { altText, imageLines, openImage, prepareImage } from '../src/images.js';
import { latexToUnicode } from '../src/journal/math.js';
import { openReplica } from '../src/replica.js';
import { tempPaths } from './helpers.js';

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});
const paths = () => {
  const p = tempPaths();
  cleanups.push(p.done);
  return p;
};

// An image of `width` × `height`: a gradient, or noise (which doesn't compress), as `format`.
async function image(width, height, { format = 'png', noise = false, alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const px = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    px[i * channels] = noise ? (Math.random() * 255) | 0 : Math.round((x / width) * 255);
    px[i * channels + 1] = noise ? (Math.random() * 255) | 0 : 40;
    px[i * channels + 2] = noise ? (Math.random() * 255) | 0 : 160;
    if (alpha) px[i * channels + 3] = x < width / 2 ? 255 : 0;
  }
  return sharp(px, { raw: { width, height, channels } })[format]().toBuffer();
}

describe('formulas as Unicode', () => {
  it('writes simple LaTeX as Unicode, keeping the spacing typed', () => {
    expect(latexToUnicode('\\sigma = 0.3')).toBe('σ = 0.3');
    expect(latexToUnicode('E = mc^2')).toBe('E = mc²');
    expect(latexToUnicode('\\chi^2 = \\sum_i (y_i - f(t_i))^2 / \\sigma_i^2')).toBe('χ² = ∑ᵢ (yᵢ − f(tᵢ))² / σᵢ²');
    expect(latexToUnicode('\\int_0^1 x^2\\,dx')).toBe('∫₀¹ x² dx');
    expect(latexToUnicode('10^{-3}')).toBe('10⁻³');
    expect(latexToUnicode('\\frac{1}{2} + \\frac{a+b}{c}')).toBe('1/2 + (a+b)/c');
    expect(latexToUnicode('\\sqrt{x+1} \\leq \\sqrt[3]{y}')).toBe('√(x+1) ≤ ∛y');
    expect(latexToUnicode('\\mathbb{R}^n, \\hat{x}, 90^\\circ, f\'(x)')).toBe('ℝⁿ, x̂, 90°, f′(x)');
    expect(latexToUnicode('\\left( \\frac{x}{2} \\right) \\text{if } x \\neq 0')).toBe('(x/2) if x ≠ 0');
    // A space that only ended a command's name goes; others stay.
    expect(latexToUnicode('3 \\mu m, \\sin x, \\alpha \\cdot \\beta')).toBe('3 μm, sin x, α ⋅ β');
  });

  it('gives up on what Unicode can\u2019t write, so it shows as LaTeX', () => {
    for (const latex of ['x^q', 'a_{b}', '\\begin{pmatrix} a \\end{pmatrix}', '\\unknown', 'a & b', '\\frac{1}', '\\hat{xy}', '']) {
      expect(latexToUnicode(latex)).toBeNull();
    }
  });
});

describe('images', () => {
  it('keeps a small image as it is, and makes a large one smaller, as WebP, as the web does', async () => {
    const plot = await image(320, 200);
    expect(await prepareImage(plot, 'plot.png')).toMatchObject({ bytes: plot, type: 'image/png', width: 320, height: 200, smaller: false });
    const photo = await image(3000, 2000, { format: 'jpeg', noise: true });
    expect(photo.length).toBeGreaterThan(1.5 * 1024 * 1024);
    const made = await prepareImage(photo, 'photo.jpg');
    expect(made).toMatchObject({ type: 'image/webp', width: 2400, height: 1600, smaller: true });
    expect(made.bytes.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    await expect(prepareImage(Buffer.from('not an image'), 'notes.txt')).rejects.toThrow('Couldn’t add “notes.txt”: it isn’t an image this can read.');
    expect([altText('light curve fit.png'), altText('image.png'), altText('Image')]).toEqual(['light curve fit', '', '']);
    expect([fileSize(340 * 1024), fileSize(2.4 * 1024 * 1024)]).toEqual(['340 KB', '2.4 MB']);
  });

  it('keeps an animated WebP whole, however large, up to 5 MB, as it does a GIF', async () => {
    const frames = await Promise.all([0, 1].map(() => image(1200, 1000, { format: 'jpeg', noise: true })));
    const moving = await sharp(frames, { join: { animated: true } }).webp({ quality: 86, effort: 0 }).toBuffer();
    expect(moving.length).toBeGreaterThan(1.5 * 1024 * 1024);
    const kept = await prepareImage(moving, 'noise.webp');
    expect(kept.bytes).toBe(moving);
    expect(kept).toMatchObject({ type: 'image/webp', width: 1200, height: 1000, smaller: false });
  });

  it('draws an image in half blocks, in its colors, transparency in the background, at most the size asked', async () => {
    const lines = await imageLines(await image(100, 40, { alpha: true }), { cols: 50, rows: 12, background: '#171614' });
    // 100 × 40 into 50 columns: 50 pixels by 20, two to a row.
    expect(lines).toHaveLength(10);
    // eslint-disable-next-line no-control-regex
    const cells = (line) => line.replace(/\x1b\[[\d;]*m/g, '');
    expect(lines.every((l) => cells(l) === '▀'.repeat(50))).toBe(true);
    // The gradient's dark end on the left (resampling moves it a shade), the background where
    // it's transparent.
    expect(lines[0]).toMatch(/^\x1b\[38;2;\d;40;160m\x1b\[48;2;\d;40;160m▀/);
    expect(lines[0]).toContain('\x1b[38;2;23;22;20m');
    // With 256 colors, the nearest of them.
    const dim = await imageLines(await image(8, 4), { cols: 8, rows: 2, background: '#ffffff', level: 2 });
    expect(dim[0]).toMatch(/^\x1b\[38;5;\d+m\x1b\[48;5;\d+m▀/);
    // Never larger than its pixels.
    expect(await imageLines(await image(8, 4), { cols: 80, rows: 20, background: '#000000' })).toHaveLength(2);
  });

  it('puts images at the end of a day, their files saved to sync, or none of them if one can\u2019t go', async () => {
    const p = paths();
    const replica = openReplica({ paths: p, server: null });
    cleanups.push(() => replica.close());
    const dir = path.join(p.root, 'in');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'light curve.png'), await image(320, 200));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    const day = '2026-10-28';
    replica.act('ensureJournal', day);

    await expect(attachFiles(replica, [path.join(dir, 'light curve.png'), path.join(dir, 'notes.txt')], day)).rejects.toThrow('isn’t an image');
    await expect(attachFiles(replica, [path.join(dir, 'gone.png')], day)).rejects.toThrow('There’s no file');
    expect(replica.queries.body(journalId(day))).toBeNull();

    const [added] = await attachFiles(replica, [path.join(dir, 'light curve.png')], day);
    expect(added).toMatchObject({ name: 'light curve.png', alt: 'light curve', width: 320, height: 200, smaller: false });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, replica.queries.body(journalId(day)));
    const [img, after] = doc.getXmlFragment(BODY_FIELD).toArray();
    expect(img.nodeName).toBe('image');
    expect(img.getAttributes()).toMatchObject({ alt: 'light curve', width: 320, height: 200 });
    expect(replica.queries.file(img.getAttribute('file'))).toMatchObject({ type: 'image/png' });
    // The journal ends with a line after it, as the web keeps it.
    expect(after.nodeName).toBe('paragraph');
  });

  it('saves an image for a viewer, and opens it only where there\u2019s a display', () => {
    const p = paths();
    const display = process.env.DISPLAY;
    const wayland = process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    try {
      const result = openImage({ bytes: Buffer.from('png'), type: 'image/png' }, 'file-1', p.images);
      expect(result.saved).toBe(path.join(p.images, 'file-1.png'));
      expect(fs.readFileSync(result.saved, 'utf8')).toBe('png');
      if (process.platform === 'linux') expect(result.opened).toBe(false);
    } finally {
      if (display !== undefined) process.env.DISPLAY = display;
      if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
    }
  });
});
