// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { imageUrlIn, isAnimatedWebp } from './web-images.js';

// Pasted or dropped data, as a DataTransfer gives it.
const data = (types) => ({ getData: (type) => types[type] ?? '' });

describe('images from the web', () => {
  it('finds the picture copied or dragged from a page, whatever its address', () => {
    // Chrome's "Copy image"; the clipboard's PNG of it is left aside.
    expect(imageUrlIn(data({ 'text/html': '<meta charset="utf-8"><img src="https://media1.tenor.com/m/aGj/cat-dance.gif"/>' }))).toBe(
      'https://media1.tenor.com/m/aGj/cat-dance.gif',
    );
    expect(imageUrlIn(data({ 'text/html': '<img src="https://lh3.googleusercontent.com/abc=w600" alt="plot">' }))).toBe(
      'https://lh3.googleusercontent.com/abc=w600',
    );
    // A dragged image from another page, with a link around it.
    const dragged = { 'text/html': '<a href="https://giphy.com/gifs/x-ID1"><img src="https://media.giphy.com/media/ID1/200.webp"></a>' };
    expect(imageUrlIn(data(dragged))).toBe('https://media.giphy.com/media/ID1/200.webp');
  });

  it('finds a link to an image, or to a GIF on Giphy or Tenor', () => {
    expect(imageUrlIn(data({ 'text/plain': ' https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif?cid=1 \n' }))).toBe(
      'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif?cid=1',
    );
    expect(imageUrlIn(data({ 'text/plain': 'https://giphy.com/gifs/cat-funny-JIX9t2j0ZTN9S' }))).toBe('https://giphy.com/gifs/cat-funny-JIX9t2j0ZTN9S');
    expect(imageUrlIn(data({ 'text/plain': 'https://tenor.com/en-GB/view/cat-dance-gif-752354' }))).toBe('https://tenor.com/en-GB/view/cat-dance-gif-752354');
    expect(imageUrlIn(data({ 'text/uri-list': '# a comment\r\nhttps://example.org/plots/fit.PNG', 'text/plain': 'fit' }))).toBe(
      'https://example.org/plots/fit.PNG',
    );
  });

  it('leaves alone anything else: other links, text with a link in it, a note’s own images', () => {
    expect(imageUrlIn(data({ 'text/plain': 'https://arxiv.org/abs/2410.01234' }))).toBeNull();
    expect(imageUrlIn(data({ 'text/plain': 'https://giphy.com/search/cats' }))).toBeNull();
    expect(imageUrlIn(data({ 'text/plain': 'look: https://media.giphy.com/media/ID/giphy.gif' }))).toBeNull();
    expect(imageUrlIn(data({ 'text/plain': 'file:///home/me/cat.gif' }))).toBeNull();
    expect(imageUrlIn(data({ 'text/html': '<p>Figure 2</p><img src="https://example.org/fig2.png">', 'text/plain': 'Figure 2' }))).toBeNull();
    expect(imageUrlIn(data({ 'text/html': '<img data-pm-slice="0 0 []" data-file="f1" alt="light curve">', 'text/plain': '[light curve]' }))).toBeNull();
    expect(imageUrlIn(data({}))).toBeNull();
  });

  it('tells an animated WebP by its header', () => {
    const webp = (chunk, flags) => {
      const bytes = new Uint8Array(32);
      bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
      bytes.set([...`WEBP${chunk}`].map((c) => c.charCodeAt(0)), 8);
      bytes[20] = flags;
      return bytes;
    };
    expect(isAnimatedWebp(webp('VP8X', 0x12))).toBe(true);
    expect(isAnimatedWebp(webp('VP8X', 0x10))).toBe(false);
    expect(isAnimatedWebp(webp('VP8 ', 0x02))).toBe(false);
  });
});
