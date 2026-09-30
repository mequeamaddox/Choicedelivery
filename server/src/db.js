const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. On Railway, add a Postgres service and reference ${{Postgres.DATABASE_URL}}.');
}

// Railway's private network (*.railway.internal) doesn't use SSL; its public proxy does.
const needsSsl = process.env.PGSSL === 'true' ||
  (process.env.PGSSL !== 'false' && /rlwy\.net|proxy\.railway/.test(process.env.DATABASE_URL));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, query: (text, params) => pool.query(text, params), migrate };
