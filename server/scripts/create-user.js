// Usage: npm run create-user -- <email> <password> [driver|admin]
const { createUser } = require('../src/routes-auth');
const { migrate, pool } = require('../src/db');

const [email, password, role = 'driver'] = process.argv.slice(2);
if (!email || !password || !['driver', 'admin'].includes(role)) {
  console.error('Usage: npm run create-user -- <email> <password> [driver|admin]');
  process.exit(1);
}

migrate()
  .then(() => createUser({ email, password, role }))
  .then((u) => console.log(`Created ${u.role} ${u.email} (${u.id})`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
