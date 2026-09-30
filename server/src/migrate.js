const { migrate, pool } = require('./db');

migrate()
  .then(() => console.log('Database schema is up to date.'))
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
