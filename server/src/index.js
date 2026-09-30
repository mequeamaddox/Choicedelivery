const app = require('./app');
const { migrate } = require('./db');

const port = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(port, '0.0.0.0', () => console.log(`Choice Delivery API listening on :${port}`));
  })
  .catch((err) => {
    console.error('Failed to apply database schema:', err);
    process.exit(1);
  });
