// Push the outbox and pull new changes until both are drained. `send(payload)` delivers
// { node, cursor, messages } to the server's sync endpoint and resolves with its reply,
// so the browser can pass a fetch wrapper and tests can call the server store directly.
// Each push carries at most `batchSize` changes and about `batchBytes` of values.
export function createSyncer(core, send, { batchSize = 500, batchBytes = 16 * 1024 * 1024 } = {}) {
  let running = null;
  let again = false;

  async function runOnce() {
    let cursor = Number(core.getMeta('cursor') ?? 0);
    for (;;) {
      const out = core.outbox(batchSize, batchBytes);
      const reply = await send({ node: core.node, cursor, messages: out.map(({ id, ...msg }) => msg) });
      core.write(() => {
        core.receive(reply.messages);
        if (out.length) core.ackOutbox(out.at(-1).id);
        core.setMeta('cursor', String(reply.cursor));
      });
      cursor = reply.cursor;
      if (!reply.more && core.outboxCount() === 0) return;
    }
  }

  // A sync requested while one is running schedules exactly one more run afterward.
  function sync() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await runOnce();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { sync, isRunning: () => running !== null };
}
