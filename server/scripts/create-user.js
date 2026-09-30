// Usage: npm run create-user -- <email> <password> [admin|dispatcher|driver] [name]
// (Shipper accounts belong to a company; create those with POST /auth/signup or /organizations/:id/users.)
const { migrate, pool } = require('../src/db');
const { createUser } = require('../src/users');

const [email, password, role = 'driver', ...nameParts] = process.argv.slice(2);
if (!email || !password || !['admin', 'dispatcher', 'driver'].includes(role)) {
  console.error('Usage: npm run create-user -- <email> <password> [admin|dispatcher|driver] [name]');
  process.exit(1);
}

migrate()
  .then(() => createUser({ email, password, role, name: nameParts.join(' ') }))
  .then((u) => console.log(`Created ${u.role} ${u.email} (${u.id})`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
