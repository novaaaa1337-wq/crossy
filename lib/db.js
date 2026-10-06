// Postgres access. On Vercel (or any host) set DATABASE_URL to a Neon/Postgres database.
// Locally, with no DATABASE_URL, an embedded Postgres (PGlite) stores data in ./.pglite.
const path = require('path');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, wallet TEXT NOT NULL, skin TEXT,
    lamports DOUBLE PRECISION NOT NULL, reference TEXT NOT NULL, message TEXT NOT NULL,
    created DOUBLE PRECISION NOT NULL, status TEXT NOT NULL, signature TEXT, result TEXT)`,
  `CREATE TABLE IF NOT EXISTS used_signatures (signature TEXT PRIMARY KEY, intent TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY, wallet TEXT NOT NULL, skin TEXT, seed DOUBLE PRECISION NOT NULL,
    created DOUBLE PRECISION NOT NULL, started DOUBLE PRECISION, round INTEGER, status TEXT NOT NULL, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS tickets_round ON tickets(round)`,
  `CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY, ticket TEXT NOT NULL UNIQUE, wallet TEXT NOT NULL, round INTEGER NOT NULL,
    score INTEGER NOT NULL, ticks INTEGER NOT NULL, submitted DOUBLE PRECISION NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS runs_round ON runs(round, score)`,
  `CREATE TABLE IF NOT EXISTS owned (wallet TEXT NOT NULL, skin TEXT NOT NULL, PRIMARY KEY (wallet, skin))`,
  `CREATE TABLE IF NOT EXISTS payouts (
    round INTEGER PRIMARY KEY, winner TEXT, score INTEGER, lamports DOUBLE PRECISION, status TEXT NOT NULL,
    signature TEXT UNIQUE, updated DOUBLE PRECISION NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

class NoDatabaseError extends Error {}

function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(url);
    return {
      query: (text, params) => sql.query(text, params || []),
      // Runs all statements in one transaction: either all of them apply or none do.
      batch: list => sql.transaction(list.map(([text, params]) => sql.query(text, params || []))),
    };
  }
  if (process.env.VERCEL) {
    throw new NoDatabaseError('No database connected. In Vercel, open Storage, add a Neon Postgres database to this project, and redeploy.');
  }
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(process.env.PGLITE_DIR || path.join(__dirname, '..', '.pglite'));
  return {
    query: async (text, params) => (await pg.query(text, params || [])).rows,
    batch: list => pg.transaction(async tx => {
      const out = [];
      for (const [text, params] of list) out.push((await tx.query(text, params || [])).rows);
      return out;
    }),
  };
}

let ready = null;
function getDb() {
  if (!ready) {
    ready = (async () => {
      const db = connect();
      try { await db.batch(SCHEMA.map(s => [s])); }
      catch (e) { await new Promise(r => setTimeout(r, 300)); await db.batch(SCHEMA.map(s => [s])); } // two cold starts racing
      return db;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

module.exports = { getDb, NoDatabaseError };
