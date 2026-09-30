const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. On Railway, reference your Postgres/Neon connection string.');
}

// Tolerate copy/paste leftovers like surrounding quotes or a "DATABASE_URL=" prefix.
const rawUrl = process.env.DATABASE_URL.trim().replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');

// SSL is configured below rather than via URL parameters, so remove sslmode/channel_binding
// (Neon adds both) while keeping any other parameters intact.
function cleanConnectionString(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch {
    throw new Error('DATABASE_URL is not a valid postgres:// connection string. Check for typos or extra characters.');
  }
}

// Railway's private network (*.railway.internal) doesn't use SSL; its public proxy and Neon do.
const needsSsl = process.env.PGSSL === 'true' ||
  (process.env.PGSSL !== 'false' && /rlwy\.net|proxy\.railway|neon\.tech|sslmode=require/.test(rawUrl));

const pool = new Pool({
  connectionString: cleanConnectionString(rawUrl),
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  // Fail fast instead of hanging forever when the database can't be reached
  // (Neon may need a few seconds to wake up; startup retries).
  connectionTimeoutMillis: 10000,
});

const query = (text, params) => pool.query(text, params);

// Runs fn(client) inside a transaction.
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Applies migrations/NNN_*.sql in order, each once, each in its own transaction.
// An advisory lock keeps two instances starting at once from racing.
async function migrate() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

module.exports = { pool, query, withTx, migrate, cleanConnectionString };
