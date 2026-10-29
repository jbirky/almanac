import fs from 'node:fs';
import net from 'node:net';

// While the TUI runs, it holds the copy's lock, so `almanac add` and `almanac sync` from
// another shell hand their work to it over a Unix socket next to the copy: one line of JSON
// asks, one answers, { ok, result } or { ok: false, error }.

// Answers requests with `handle(request)`, which may return a promise.
export function serveControl(socketPath, handle) {
  // Left by a TUI that didn't get to clean up. Whoever holds the lock owns the socket.
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer((conn) => {
    let buffer = '';
    conn.setEncoding('utf8');
    conn.on('error', () => {});
    conn.on('data', async (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = '';
      let reply;
      try {
        reply = { ok: true, result: await handle(JSON.parse(line)) };
      } catch (err) {
        reply = { ok: false, error: err.message };
      }
      conn.end(`${JSON.stringify(reply)}\n`);
    });
  });
  server.on('error', () => {});
  server.listen(socketPath);
  return {
    close() {
      server.close();
      fs.rmSync(socketPath, { force: true });
    },
  };
}

// Sends one request to the running TUI and resolves with its result. Rejects with an error whose
// code is ENOENT or ECONNREFUSED when no TUI is listening.
export function askRunning(socketPath, request, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketPath);
    let buffer = '';
    conn.setEncoding('utf8');
    conn.setTimeout(timeout, () => conn.destroy(new Error('Almanac in the other terminal didn’t answer.')));
    conn.on('connect', () => conn.write(`${JSON.stringify(request)}\n`));
    conn.on('data', (chunk) => (buffer += chunk));
    conn.on('error', reject);
    conn.on('end', () => {
      try {
        const reply = JSON.parse(buffer);
        if (reply.ok) resolve(reply.result);
        else reject(new Error(reply.error));
      } catch {
        reject(new Error('Almanac in the other terminal gave an answer this one can’t read.'));
      }
    });
  });
}
