// Wraps a SQLite driver (better-sqlite3 on the server, sqlite-wasm in the browser) in the
// small synchronous interface the core uses. `run` and `all` take positional parameters.
export function createAdapter({ exec, run, all }) {
  const clean = (params) => params.map((p) => (p === undefined ? null : p));
  let depth = 0;
  return {
    exec,
    run: (sql, params = []) => run(sql, clean(params)),
    all: (sql, params = []) => all(sql, clean(params)),
    get: (sql, params = []) => all(sql, clean(params))[0],
    // Nested calls join the outer transaction.
    transaction(fn) {
      if (depth > 0) return fn();
      exec('BEGIN');
      depth++;
      try {
        const result = fn();
        exec('COMMIT');
        return result;
      } catch (err) {
        exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
  };
}

// The adapter over a better-sqlite3 database (the server's, the terminal's), each statement
// prepared once. It only calls the driver it's given, so shared/ doesn't depend on it.
export function adaptBetterSqlite(raw) {
  const statements = new Map();
  const prepare = (sql) => {
    let stmt = statements.get(sql);
    if (!stmt) {
      stmt = raw.prepare(sql);
      statements.set(sql, stmt);
    }
    return stmt;
  };
  return createAdapter({
    exec: (sql) => raw.exec(sql),
    run: (sql, params) => prepare(sql).run(params),
    all: (sql, params) => prepare(sql).all(params),
  });
}
