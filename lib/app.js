// The Crossy API as an Express app. Runs as a Vercel function (api/index.js) or as a normal
// server (local-server.js). It keeps no state between requests except small caches.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const web3 = require('@solana/web3.js');
const Sim = require('../public/sim.js');
const cfg = require('../config');
const { getDb, NoDatabaseError } = require('./db');

// Bad settings are reported (on every API call and on /api/health) instead of crashing the server.
let receiver = null, conn = null;
const setupErrors = [];
try { receiver = new web3.PublicKey(cfg.receiver); }
catch { setupErrors.push(`RECEIVER_WALLET "${cfg.receiver}" is not a valid Solana address.`); }
try { conn = new web3.Connection(cfg.rpcUrl, 'confirmed'); }
catch (e) { setupErrors.push(`RPC_URL is not a valid address (${e.message}). It must start with https://`); }

/* ---------- helpers ---------- */
const now = () => Date.now();
const roundOf = t => Math.floor(t / cfg.roundMs);
const newId = () => crypto.randomBytes(16).toString('hex');
const RENT_MIN = 890880, FEE = 5000;

function parseWallet(w) {
  if (typeof w !== 'string' || w.length > 50) return null;
  try { const pk = new web3.PublicKey(w); return pk.toBase58() === w ? pk : null; } catch { return null; }
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  if (err instanceof NoDatabaseError) return res.status(503).json({ error: err.message });
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Server error. Open /api/health to see what is failing.' });
});

// Small per-instance limiter for write endpoints.
const hits = new Map();
function limit(req, res, next) {
  const key = req.ip, t = now();
  const h = hits.get(key) || { n: 0, reset: t + 60000 };
  if (t > h.reset) { h.n = 0; h.reset = t + 60000; }
  h.n++; hits.set(key, h);
  if (hits.size > 50000) hits.clear();
  if (h.n > 90) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  next();
}

async function waitForTx(signature, ms) {
  const end = now() + ms;
  while (now() < end) {
    const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (tx) return tx;
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;
}
function txKeys(tx) {
  const msg = tx.transaction.message;
  return (msg.staticAccountKeys || msg.accountKeys).map(k => k.toBase58());
}

/* ---------- data access ---------- */
let firstRound = null;
async function roundNumber(r) {
  if (firstRound === null) {
    const db = await getDb();
    await db.query('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', ['firstRound', String(roundOf(now()))]);
    firstRound = Number((await db.query("SELECT value FROM meta WHERE key = 'firstRound'"))[0].value);
  }
  return r - firstRound + 1;
}
async function entries(round) {
  const db = await getDb();
  return (await db.query("SELECT COUNT(*)::int AS n FROM tickets WHERE round = $1 AND status <> 'paid'", [round]))[0].n;
}
async function poolFor(round) { return cfg.basePoolLamports + cfg.entryLamports * await entries(round); }
async function leaderboard(round, n) {
  const db = await getDb();
  // Each wallet's best run; ties go to whoever got the score first.
  return db.query(`
    SELECT wallet, score FROM (
      SELECT DISTINCT ON (wallet) wallet, score, id FROM runs WHERE round = $1 ORDER BY wallet, score DESC, id ASC
    ) best ORDER BY score DESC, id ASC LIMIT $2`, [round, n]);
}
async function payoutFor(round) {
  const db = await getDb();
  return (await db.query('SELECT * FROM payouts WHERE round = $1', [round]))[0] || null;
}
async function ownedSkins(wallet) {
  const db = await getDb();
  return (await db.query('SELECT skin FROM owned WHERE wallet = $1', [wallet])).map(r => r.skin);
}

/* ---------- payouts (sent by hand) ----------
 * When a round is final, record the winner and the amount owed. There is no background timer on
 * serverless hosts, so this runs on incoming requests, at most every 15 seconds per instance. */
let lastSettle = 0;
async function settle() {
  if (now() - lastSettle < 15000) return;
  lastSettle = now();
  const db = await getDb();
  const lastClosed = roundOf(now() - cfg.settleDelayMs) - 1;
  const rows = await db.query("SELECT DISTINCT round FROM tickets WHERE round IS NOT NULL AND round <= $1 AND round NOT IN (SELECT round FROM payouts)", [lastClosed]);
  for (const { round } of rows) {
    const top = (await leaderboard(round, 1))[0];
    if (top) {
      const owed = await poolFor(round);
      await db.query("INSERT INTO payouts (round, winner, score, lamports, status, updated) VALUES ($1, $2, $3, $4, 'owed', $5) ON CONFLICT (round) DO NOTHING",
        [round, top.wallet, top.score, owed, now()]);
      console.log(`Round #${await roundNumber(round)} won by ${top.wallet} with ${top.score}. Owed ${owed / 1e9} SOL.`);
    } else {
      await db.query("INSERT INTO payouts (round, winner, score, lamports, status, updated) VALUES ($1, NULL, NULL, 0, 'no_runs', $2) ON CONFLICT (round) DO NOTHING", [round, now()]);
    }
  }
  if (rows.length) snapCache = null;
}

let snapCache = null;
async function roundSnapshot() {
  if (snapCache && now() - snapCache.at < 1000) return { ...snapCache.data, now: now() };
  await settle();
  const t = now(), round = roundOf(t), prevRound = round - 1;
  const [paid, board, prevBoard, pool, count, number, prevNumber, prevPool] = await Promise.all([
    payoutFor(prevRound), leaderboard(round, 20), leaderboard(prevRound, 1), poolFor(round), entries(round),
    roundNumber(round), roundNumber(prevRound), poolFor(prevRound),
  ]);
  const prevTop = paid ? { wallet: paid.winner, score: paid.score } : prevBoard[0] || null;
  const data = {
    now: t, round, number, endsAt: (round + 1) * cfg.roundMs,
    poolLamports: pool, entries: count, leaderboard: board,
    prev: {
      round: prevRound, number: prevNumber,
      winner: prevTop && prevTop.wallet, score: prevTop && prevTop.score,
      lamports: paid ? paid.lamports : prevPool,
      status: paid ? paid.status : (prevTop ? 'settling' : 'no_runs'),
      signature: paid && paid.status === 'paid' ? paid.signature : null,
      settlesAt: (prevRound + 1) * cfg.roundMs + cfg.settleDelayMs,
    },
  };
  snapCache = { at: t, data };
  return data;
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (setupErrors.length && req.path !== '/health') return res.status(503).json({ error: `Server setting problem: ${setupErrors.join(' ')}` });
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    cluster: cfg.cluster, receiver: receiver.toBase58(),
    entryLamports: cfg.entryLamports, basePoolLamports: cfg.basePoolLamports,
    roundMs: cfg.roundMs, skins: cfg.skins,
  });
});

app.get('/api/round', wrap(async (req, res) => res.json(await roundSnapshot())));

// Open /api/health in a browser to see what is working on this deployment.
app.get('/api/health', async (req, res) => {
  const out = {
    ok: true,
    node: process.version,
    onVercel: !!process.env.VERCEL,
    databaseUrlSet: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    adminTokenSet: !!cfg.adminToken,
    rpcHost: (() => { try { return new URL(cfg.rpcUrl).host; } catch { return 'invalid RPC_URL'; } })(),
    receiver: receiver ? receiver.toBase58() : null,
    settingErrors: setupErrors,
    settingWarnings: cfg.problems,
  };
  if (setupErrors.length) out.ok = false;
  try { const db = await getDb(); await db.query('SELECT 1'); out.database = 'ok'; }
  catch (e) { out.ok = false; out.database = 'failed: ' + String(e.message).split('\n')[0].replace(/postgres(ql)?:\/\/\S+/g, '[connection string]'); }
  try { if (!conn) throw new Error('RPC_URL is invalid'); await conn.getLatestBlockhash('confirmed'); out.solana = 'ok'; }
  catch (e) { out.ok = false; out.solana = 'failed: ' + String(e.message).split('\n')[0]; }
  res.status(out.ok ? 200 : 500).json(out);
});

app.get('/api/me', wrap(async (req, res) => {
  const pk = parseWallet(req.query.wallet);
  if (!pk) throw new HttpError(400, 'Invalid wallet address.');
  res.json({ skins: [...new Set(['chicken', ...await ownedSkins(pk.toBase58())])] });
}));

/* ---------- built-in wallet support (keys stay in the browser; the server only builds and relays) ---------- */
const balCache = new Map();
async function balanceOf(pk) {
  const k = pk.toBase58(), c = balCache.get(k);
  if (c && now() - c.t < 3000) return c.v;
  const v = await conn.getBalance(pk, 'confirmed');
  balCache.set(k, { v, t: now() });
  if (balCache.size > 20000) balCache.clear();
  return v;
}
app.get('/api/balance', wrap(async (req, res) => {
  const pk = parseWallet(req.query.wallet);
  if (!pk) throw new HttpError(400, 'Invalid wallet address.');
  res.json({ lamports: await balanceOf(pk) });
}));
app.post('/api/withdraw-tx', limit, wrap(async (req, res) => {
  const { from, to, sol: amount, max } = req.body || {};
  const fromPk = parseWallet(from), toPk = parseWallet(to);
  if (!fromPk) throw new HttpError(400, 'Invalid wallet.');
  if (!toPk) throw new HttpError(400, 'That is not a valid Solana address.');
  if (fromPk.equals(toPk)) throw new HttpError(400, 'That is this wallet. Enter a different address.');
  balCache.delete(fromPk.toBase58());
  const bal = await balanceOf(fromPk);
  let lamports;
  if (max) lamports = bal - FEE;
  else {
    if (typeof amount !== 'string' || !/^\d+(\.\d{1,9})?$/.test(amount)) throw new HttpError(400, 'Enter an amount in SOL, like 0.25.');
    lamports = cfg.sol(amount);
  }
  if (lamports <= 0) throw new HttpError(400, 'There is nothing to withdraw.');
  if (lamports + FEE > bal) throw new HttpError(400, `Not enough SOL. You can send up to ${Math.max(0, bal - FEE) / 1e9} SOL.`);
  const rest = bal - lamports - FEE;
  if (rest > 0 && rest < RENT_MIN) throw new HttpError(400, `Solana requires leaving at least ${RENT_MIN / 1e9} SOL or nothing. Send a little less, or press Max.`);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: fromPk, blockhash, lastValidBlockHeight })
    .add(web3.SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports }));
  res.json({ lamports, tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') });
}));
// Relays a signed withdrawal. Only plain SOL transfers out of the signing wallet are accepted.
app.post('/api/send', limit, wrap(async (req, res) => {
  let raw, tx;
  try { raw = Buffer.from(String((req.body || {}).tx), 'base64'); tx = web3.Transaction.from(raw); } catch { throw new HttpError(400, 'Could not read the signed transaction.'); }
  if (!tx.verifySignatures() || !tx.instructions.length) throw new HttpError(400, 'The transaction is not signed correctly.');
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(web3.SystemProgram.programId) || web3.SystemInstruction.decodeInstructionType(ix) !== 'Transfer' ||
        !web3.SystemInstruction.decodeTransfer(ix).fromPubkey.equals(tx.feePayer)) {
      throw new HttpError(400, 'Only SOL withdrawals can be sent here.');
    }
  }
  const signature = await conn.sendRawTransaction(raw).catch(e => { throw new HttpError(400, `Solana rejected the transfer: ${e.message.split('\n')[0]}`); });
  balCache.delete(tx.feePayer.toBase58());
  res.json({ signature });
}));
app.get('/api/tx-status', wrap(async (req, res) => {
  const sig = String(req.query.sig || '');
  if (sig.length < 60 || sig.length > 100) throw new HttpError(400, 'Invalid signature.');
  const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true })).value;
  if (!st) return res.json({ status: 'pending' });
  if (st.err) return res.json({ status: 'failed' });
  res.json({ status: st.confirmationStatus === 'processed' ? 'pending' : 'confirmed' });
}));

/* ---------- payments ---------- */
// Step 1: the server builds the exact transfer so it can recognise it later.
app.post('/api/intent', limit, wrap(async (req, res) => {
  const { kind, wallet, skin } = req.body || {};
  const pk = parseWallet(wallet);
  if (!pk) throw new HttpError(400, 'Invalid wallet.');
  let lamports, skinId = null;
  if (kind === 'entry') {
    lamports = cfg.entryLamports;
  } else if (kind === 'skin') {
    const s = cfg.skins.find(x => x.id === skin);
    if (!s || s.lamports === 0) throw new HttpError(400, 'That character is not for sale.');
    if ((await ownedSkins(pk.toBase58())).includes(s.id)) throw new HttpError(409, `You already own the ${s.name}.`);
    lamports = s.lamports; skinId = s.id;
  } else throw new HttpError(400, 'Unknown payment type.');

  const reference = web3.Keypair.generate().publicKey;
  const ix = web3.SystemProgram.transfer({ fromPubkey: pk, toPubkey: receiver, lamports });
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: pk, blockhash, lastValidBlockHeight }).add(ix);
  const id = newId();
  const db = await getDb();
  await db.query("INSERT INTO intents (id, kind, wallet, skin, lamports, reference, message, created, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')",
    [id, kind, pk.toBase58(), skinId, lamports, reference.toBase58(), tx.serializeMessage().toString('base64'), now()]);
  res.json({ intentId: id, lamports, tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') });
}));

async function getIntent(id) {
  if (typeof id !== 'string' || id.length > 64) return null;
  const db = await getDb();
  return (await db.query('SELECT * FROM intents WHERE id = $1', [id]))[0] || null;
}

// The browser signs; the server relays only the exact transaction it built.
app.post('/api/relay', limit, wrap(async (req, res) => {
  const { intentId, tx } = req.body || {};
  const intent = await getIntent(intentId);
  if (!intent || intent.status !== 'pending') throw new HttpError(400, 'This payment request has expired. Start again.');
  let parsed, raw;
  try { raw = Buffer.from(String(tx), 'base64'); parsed = web3.Transaction.from(raw); } catch { throw new HttpError(400, 'Could not read the signed transaction.'); }
  if (parsed.serializeMessage().toString('base64') !== intent.message || !parsed.verifySignatures()) {
    throw new HttpError(400, 'The signed transaction does not match the payment request.');
  }
  const signature = await conn.sendRawTransaction(raw).catch(e => { throw new HttpError(400, `Solana rejected the transaction: ${e.message.split('\n')[0]}`); });
  res.json({ signature });
}));

// Step 2: verify the payment on chain, then hand out a run ticket or the character.
app.post('/api/confirm', limit, wrap(async (req, res) => {
  const { intentId, signature } = req.body || {};
  const intent = await getIntent(intentId);
  if (!intent) throw new HttpError(404, 'Payment request not found.');
  if (intent.status === 'done') return res.json(JSON.parse(intent.result));
  if (intent.status === 'failed') throw new HttpError(400, 'This payment failed on chain. No SOL was taken.');
  if (typeof signature !== 'string' || signature.length < 60 || signature.length > 100) throw new HttpError(400, 'Invalid transaction signature.');
  const db = await getDb();

  const tx = await waitForTx(signature, 8000);
  if (!tx) {
    if (now() - intent.created > 10 * 60000) throw new HttpError(400, 'Payment was not found on chain. If SOL left your wallet, contact support with your transaction signature.');
    return res.status(202).json({ pending: true }); // the browser asks again
  }
  if (tx.meta && tx.meta.err) {
    await db.query("UPDATE intents SET status = 'failed', signature = $1 WHERE id = $2 AND status = 'pending'", [signature, intent.id]);
    throw new HttpError(400, 'This payment failed on chain. No SOL was taken.');
  }
  const keys = txKeys(tx);
  const ri = keys.indexOf(receiver.toBase58());
  const received = ri >= 0 ? tx.meta.postBalances[ri] - tx.meta.preBalances[ri] : 0;
  if (keys[0] !== intent.wallet || !keys.includes(intent.reference) || received < intent.lamports) {
    throw new HttpError(400, 'That transaction is not the payment we asked for.');
  }

  // One transaction: claim the signature, finish the intent, grant the ticket or character.
  // If the signature was already claimed, nothing here applies.
  let result;
  const grant = [];
  if (intent.kind === 'entry') {
    result = { kind: 'entry', ticketId: newId() };
    grant.push(["INSERT INTO tickets (id, wallet, seed, created, status) VALUES ($1, $2, $3, $4, 'paid')",
      [result.ticketId, intent.wallet, crypto.randomBytes(4).readUInt32LE(0), now()]]);
  } else {
    result = { kind: 'skin', skin: intent.skin };
    grant.push(['INSERT INTO owned (wallet, skin) VALUES ($1, $2) ON CONFLICT DO NOTHING', [intent.wallet, intent.skin]]);
  }
  try {
    await db.batch([
      ['INSERT INTO used_signatures (signature, intent) VALUES ($1, $2)', [signature, intent.id]],
      ["UPDATE intents SET status = 'done', signature = $1, result = $2 WHERE id = $3", [signature, JSON.stringify(result), intent.id]],
      ...grant,
    ]);
  } catch (e) {
    const again = await getIntent(intent.id);
    if (again && again.status === 'done') return res.json(JSON.parse(again.result));
    throw new HttpError(409, 'That transaction was already used.');
  }
  snapCache = null;
  res.json(result);
}));

/* ---------- ranked runs ---------- */
// The seed stays secret until the player presses start, and the clock starts then.
app.post('/api/run/start', limit, wrap(async (req, res) => {
  const { ticketId, skin } = req.body || {};
  if (typeof ticketId !== 'string' || ticketId.length > 64) throw new HttpError(404, 'Run ticket not found.');
  const db = await getDb();
  const t = (await db.query('SELECT * FROM tickets WHERE id = $1', [ticketId]))[0];
  if (!t) throw new HttpError(404, 'Run ticket not found.');
  if (t.status !== 'paid') throw new HttpError(409, 'This paid run was already used.');
  const s = cfg.skins.find(x => x.id === skin);
  if (!s) throw new HttpError(400, 'Unknown character.');
  if (s.lamports > 0 && !(await ownedSkins(t.wallet)).includes(s.id)) {
    throw new HttpError(403, `Buy the ${s.name} before playing with it. Your paid run is still saved.`);
  }
  const started = now(), round = roundOf(started);
  const rows = await db.query("UPDATE tickets SET status = 'started', started = $1, round = $2, skin = $3 WHERE id = $4 AND status = 'paid' RETURNING seed",
    [started, round, s.id, t.id]);
  if (!rows.length) throw new HttpError(409, 'This paid run was already used.');
  snapCache = null;
  res.json({ seed: rows[0].seed, round, maxTicks: Sim.MAX_TICKS });
}));

app.post('/api/run', limit, wrap(async (req, res) => {
  const { ticketId, inputs, score } = req.body || {};
  if (typeof ticketId !== 'string' || ticketId.length > 64) throw new HttpError(404, 'Run ticket not found.');
  const db = await getDb();
  // Claim the ticket first so the same run can never be submitted twice.
  const t = (await db.query("UPDATE tickets SET status = 'checking' WHERE id = $1 AND status = 'started' RETURNING *", [ticketId]))[0];
  if (!t) {
    const exists = (await db.query('SELECT 1 FROM tickets WHERE id = $1', [ticketId])).length;
    throw new HttpError(exists ? 409 : 404, exists ? 'This run was already submitted.' : 'Run ticket not found.');
  }
  const reject = async reason => {
    await db.query("UPDATE tickets SET status = 'rejected', note = $1 WHERE id = $2", [reason, t.id]);
    throw new HttpError(400, reason);
  };
  const rep = Sim.replay(t.seed, inputs);
  if (!rep.ok) await reject('This run could not be verified.');
  if (rep.score !== score) await reject('The score did not match the replay of your run.');
  const runSec = rep.ticks / Sim.TPS, elapsed = (now() - t.started) / 1000;
  if (elapsed + 2 < runSec) await reject('This run finished faster than real time.');
  if (elapsed > runSec + 25) await reject('Ranked runs cannot be paused. This run took too long to submit.');
  if (await payoutFor(t.round)) await reject('That round is already final.');

  await db.batch([
    ['INSERT INTO runs (ticket, wallet, round, score, ticks, submitted) VALUES ($1, $2, $3, $4, $5, $6)', [t.id, t.wallet, t.round, rep.score, rep.ticks, now()]],
    ["UPDATE tickets SET status = 'scored' WHERE id = $1", [t.id]],
  ]);
  snapCache = null;
  const board = await leaderboard(t.round, 1000);
  const rank = board.findIndex(r => r.wallet === t.wallet) + 1;
  const mine = board[rank - 1];
  res.json({ ok: true, score: rep.score, round: t.round, rank, best: mine ? mine.score : rep.score });
}));

/* ---------- admin: manual payouts ---------- */
function requireAdmin(req, res, next) {
  if (!cfg.adminToken) return res.status(503).json({ error: 'Set ADMIN_TOKEN on the server to use the admin page.' });
  const given = Buffer.from(String(req.get('authorization') || '').replace(/^Bearer /, ''));
  const want = Buffer.from(cfg.adminToken);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  next();
}
app.get('/api/admin/payouts', limit, requireAdmin, wrap(async (req, res) => {
  lastSettle = 0;
  await settle();
  const db = await getDb();
  const rows = await db.query("SELECT * FROM payouts WHERE status <> 'no_runs' ORDER BY round DESC LIMIT 200");
  const payouts = [];
  for (const p of rows) {
    payouts.push({
      round: p.round, number: await roundNumber(p.round), winner: p.winner, score: p.score,
      lamports: p.lamports, status: p.status, signature: p.signature, closedAt: (p.round + 1) * cfg.roundMs,
    });
  }
  res.json({ cluster: cfg.cluster, payouts });
}));
// Checks on chain that the pasted transaction really sent at least the owed amount to the winner.
app.post('/api/admin/payouts/:round/paid', limit, requireAdmin, wrap(async (req, res) => {
  const round = Number(req.params.round);
  const p = Number.isInteger(round) && await payoutFor(round);
  if (!p) throw new HttpError(404, 'No payout for that round.');
  if (p.status !== 'owed') throw new HttpError(409, 'That round is already marked paid.');
  const signature = String((req.body || {}).signature || '').trim();
  if (signature.length < 60 || signature.length > 100) throw new HttpError(400, 'Paste the transaction signature from your wallet or Solscan.');
  const db = await getDb();
  const other = (await db.query('SELECT round FROM payouts WHERE signature = $1', [signature]))[0];
  if (other) throw new HttpError(409, `That transaction is already used for round #${await roundNumber(other.round)}.`);
  const tx = await waitForTx(signature, 8000);
  if (!tx) throw new HttpError(400, 'That transaction was not found on chain yet. Wait a few seconds and try again.');
  if (tx.meta && tx.meta.err) throw new HttpError(400, 'That transaction failed on chain.');
  const keys = txKeys(tx);
  const wi = keys.indexOf(p.winner);
  const got = wi >= 0 ? tx.meta.postBalances[wi] - tx.meta.preBalances[wi] : 0;
  if (got < p.lamports) {
    throw new HttpError(400, `That transaction sent ${Math.max(0, got) / 1e9} SOL to the winner, but ${p.lamports / 1e9} SOL is owed.`);
  }
  await db.query("UPDATE payouts SET status = 'paid', signature = $1, updated = $2 WHERE round = $3 AND status = 'owed'", [signature, now(), round]);
  snapCache = null;
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

module.exports = app;
