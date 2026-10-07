// Runs Crossy as a normal server (local development, Railway, Render, a VPS).
const cfg = require('./config');
const app = require('./lib/app');

app.listen(cfg.port, () => {
  console.log(`Crossy running on http://localhost:${cfg.port}`);
  console.log(`Payments go to: ${cfg.receiver}`);
  console.log(process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'Database: Postgres (DATABASE_URL)' : 'Database: local PGlite in ./.pglite');
  console.log(`Prizes are paid by hand from /admin.html${cfg.adminToken ? '' : ' (set ADMIN_TOKEN to enable it)'}`);
});
