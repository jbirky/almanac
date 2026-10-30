import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchImage, giphyMedia, isPrivate } from '../src/images.js';

// A 1 × 1 GIF.
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

let server;
let base;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (status, type, body, headers = {}) => res.writeHead(status, { 'Content-Type': type, ...headers }).end(body);
    switch (req.url) {
      case '/cat%20dance.gif':
        return send(200, 'image/gif', GIF);
      case '/mislabeled':
        return send(200, 'application/octet-stream', GIF);
      case '/moved':
        return send(302, 'text/plain', '', { Location: '/cat%20dance.gif' });
      case '/loop':
        return send(302, 'text/plain', '', { Location: '/loop' });
      case '/view/cat-dance-gif-123':
        return send(200, 'text/html; charset=utf-8', `<html><head><meta property="og:title" content="Cat dance">
          <meta class="dynamic" property="og:image" content="/media/cat-dance.gif?a=1&amp;b=2"></head></html>`);
      case '/media/cat-dance.gif?a=1&b=2':
        return send(200, 'image/gif', GIF);
      case '/about':
        return send(200, 'text/html', '<html><head><title>About</title></head></html>');
      case '/big.gif':
        return send(200, 'image/gif', '', { 'Content-Length': String(30 * 1024 * 1024) });
      default:
        return send(404, 'text/plain', 'Not here');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const local = { allowPrivate: true };

describe('images fetched from the web', () => {
  it('fetches an image as it is, its kind told by its bytes, following redirects', async () => {
    expect(await fetchImage(`${base}/cat%20dance.gif`, local)).toEqual({ bytes: GIF, type: 'image/gif', name: 'cat dance.gif' });
    expect(await fetchImage(`${base}/mislabeled`, local)).toEqual({ bytes: GIF, type: 'image/gif', name: 'mislabeled.gif' });
    expect(await fetchImage(`${base}/moved`, local)).toMatchObject({ type: 'image/gif', name: 'cat dance.gif' });
  });

  it('fetches the image a page shows when shared, as a Tenor page’s GIF', async () => {
    expect(await fetchImage(`${base}/view/cat-dance-gif-123`, local)).toEqual({ bytes: GIF, type: 'image/gif', name: 'cat-dance.gif' });
  });

  it('finds the GIF behind a Giphy page from its address, as Giphy’s WebP of it', () => {
    const media = (address) => {
      const found = giphyMedia(new URL(address));
      return found && { url: found.url.href, name: found.name };
    };
    expect(media('https://giphy.com/gifs/cat-funny-JIX9t2j0ZTN9S')).toEqual({
      url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.webp',
      name: 'cat-funny.webp',
    });
    expect(media('https://www.giphy.com/stickers/JIX9t2j0ZTN9S/')).toEqual({
      url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.webp',
      name: 'giphy.webp',
    });
    expect(media('https://giphy.com/embed/JIX9t2j0ZTN9S')?.url).toBe('https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.webp');
    expect(media('https://giphy.com/search/cats')).toBeNull();
    expect(media('https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif')).toBeNull();
  });

  it('says why when there’s no image to be had', async () => {
    await expect(fetchImage('ftp://example.com/cat.gif', local)).rejects.toThrow("That isn't a web address.");
    await expect(fetchImage(`${base}/about`, local)).rejects.toThrow("There's no image at 127.0.0.1");
    await expect(fetchImage(`${base}/gone.gif`, local)).rejects.toThrow(/answered 404/);
    await expect(fetchImage(`${base}/loop`, local)).rejects.toThrow('sent it on too many times');
    await expect(fetchImage(`${base}/big.gif`, local)).rejects.toThrow("It's over 25 MB.");
  });

  it('won’t fetch from this machine or its networks', async () => {
    const port = server.address().port;
    await expect(fetchImage(`${base}/cat%20dance.gif`)).rejects.toThrow('127.0.0.1 is on a private network');
    await expect(fetchImage(`http://localhost:${port}/cat%20dance.gif`)).rejects.toThrow('localhost is on a private network');
    await expect(fetchImage(`http://[::1]:${port}/cat%20dance.gif`)).rejects.toThrow('::1 is on a private network');
    await expect(fetchImage('http://192.168.1.1/cat.gif')).rejects.toThrow('192.168.1.1 is on a private network');
    await expect(fetchImage('http://[::ffff:127.0.0.1]/cat.gif')).rejects.toThrow('::ffff:7f00:1 is on a private network');
  });

  it('tells public addresses from private ones', () => {
    expect(['146.75.105.32', '8.8.8.8', '172.217.119.4', '2606:4700:10::6814:179a'].map(isPrivate)).toEqual([false, false, false, false]);
    expect(['10.1.2.3', '100.101.102.103', '172.20.0.1', 'fd7a:115c:a1e0::1', 'fe80::1', '::ffff:192.168.0.1'].map(isPrivate)).toEqual([
      true, true, true, true, true, true,
    ]);
  });
});
