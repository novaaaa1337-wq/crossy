const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const web3 = require('@solana/web3.js');
const Sim = require('./public/sim.js');
const cfg = require('./config');

/* ---------- setup ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(str) {
  let n = 0n;
  for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('invalid base58'); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return Uint8Array.from(out);
}
// The treasury key can come from the TREASURY_SECRET environment variable (base58 or a JSON array,
// which is what hosting dashboards are for) or from a keypair file.
function loadKeypair() {
  const secret = (process.env.TREASURY_SECRET || '').trim();
  try {
    if (secret) return web3.Keypair.fromSecretKey(secret.startsWith('[') ? Uint8Array.from(JSON.parse(secret)) : base58Decode(secret));
  } catch (e) {
    console.error('TREASURY_SECRET is set but is not a valid Solana private key.');
    process.exit(1);
  }
  const p = path.resolve(__dirname, cfg.treasuryKeypair);
  if (!fs.existsSync(p)) {
    console.error(`No treasury key. Set TREASURY_SECRET, or put a keypair file at ${p}.`);
    process.exit(1);
  }
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}
const treasury = loadKeypair();
let receiver;
try { receiver = new web3.PublicKey(cfg.receiver); } catch {
  console.error(`RECEIVER_WALLET "${cfg.receiver}" is not a valid Solana address.`);
  process.exit(1);
}
const conn = new web3.Connection(cfg.rpcUrl, 'confirmed');
const db = new DatabaseSync(path.resolve(__dirname, cfg.dbPath));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, wallet TEXT NOT NULL, skin TEXT,
    lamports INTEGER NOT NULL, reference TEXT NOT NULL, message TEXT NOT NULL,
    created INTEGER NOT NULL, status TEXT NOT NULL, signature TEXT, result TEXT
  );
  CREATE TABLE IF NOT EXISTS used_signatures (signature TEXT PRIMARY KEY, intent TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY, wallet TEXT NOT NULL, skin TEXT, seed INTEGER NOT NULL,
    created INTEGER NOT NULL, started INTEGER, round INTEGER, status TEXT NOT NULL, note TEXT
  );
  CREATE INDEX IF NOT EXISTS tickets_round ON tickets(round);
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket TEXT NOT NULL UNIQUE, wallet TEXT NOT NULL,
    round INTEGER NOT NULL, score INTEGER NOT NULL, ticks INTEGER NOT NULL, submitted INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runs_round ON runs(round, score);
  CREATE TABLE IF NOT EXISTS owned (wallet TEXT NOT NULL, skin TEXT NOT NULL, PRIMARY KEY (wallet, skin));
  CREATE TABLE IF NOT EXISTS payouts (
    round INTEGER PRIMARY KEY, winner TEXT, score INTEGER, lamports INTEGER, status TEXT NOT NULL,
    signature TEXT, last_valid INTEGER, error TEXT, updated INTEGER NOT NULL
  );
`);

// Rounds are numbered for players from #1, starting with the round the server first ran in.
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('firstRound', String(Math.floor(Date.now() / cfg.roundMs)));
const FIRST_ROUND = Number(db.prepare("SELECT value FROM meta WHERE key = 'firstRound'").get().value);
const roundNumber = r => r - FIRST_ROUND + 1;

const q = {
  intent: db.prepare('SELECT * FROM intents WHERE id = ?'),
  addIntent: db.prepare('INSERT INTO intents (id, kind, wallet, skin, lamports, reference, message, created, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  finishIntent: db.prepare("UPDATE intents SET status = ?, signature = ?, result = ? WHERE id = ?"),
  sigUsed: db.prepare('SELECT intent FROM used_signatures WHERE signature = ?'),
  useSig: db.prepare('INSERT INTO used_signatures (signature, intent) VALUES (?, ?)'),
  ticket: db.prepare('SELECT * FROM tickets WHERE id = ?'),
  addTicket: db.prepare("INSERT INTO tickets (id, wallet, skin, seed, created, status) VALUES (?, ?, ?, ?, ?, 'paid')"),
  startTicket: db.prepare("UPDATE tickets SET status = 'started', started = ?, round = ?, skin = ? WHERE id = ? AND status = 'paid'"),
  closeTicket: db.prepare('UPDATE tickets SET status = ?, note = ? WHERE id = ?'),
  entries: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE round = ? AND status != 'paid'"),
  addRun: db.prepare('INSERT INTO runs (ticket, wallet, round, score, ticks, submitted) VALUES (?, ?, ?, ?, ?, ?)'),
  board: db.prepare(`
    SELECT wallet, score, submitted FROM runs r
    WHERE round = ? AND NOT EXISTS (
      SELECT 1 FROM runs r2 WHERE r2.round = r.round AND r2.wallet = r.wallet
        AND (r2.score > r.score OR (r2.score = r.score AND r2.id < r.id)))
    ORDER BY score DESC, id ASC LIMIT ?`),
  owned: db.prepare('SELECT skin FROM owned WHERE wallet = ?'),
  addOwned: db.prepare('INSERT OR IGNORE INTO owned (wallet, skin) VALUES (?, ?)'),
  payout: db.prepare('SELECT * FROM payouts WHERE round = ?'),
  addPayout: db.prepare('INSERT OR IGNORE INTO payouts (round, winner, score, lamports, status, updated) VALUES (?, ?, ?, ?, ?, ?)'),
  openPayouts: db.prepare("SELECT * FROM payouts WHERE status IN ('pending', 'sending') ORDER BY round"),
  setPayout: db.prepare('UPDATE payouts SET status = ?, signature = ?, last_valid = ?, error = ?, updated = ? WHERE round = ?'),
  unsettledRounds: db.prepare("SELECT DISTINCT round FROM tickets WHERE round IS NOT NULL AND round <= ? AND round NOT IN (SELECT round FROM payouts)"),
};

/* ---------- helpers ---------- */
const now = () => Date.now();
const roundOf = t => Math.floor(t / cfg.roundMs);
const newId = () => crypto.randomBytes(16).toString('hex');
const poolFor = round => cfg.basePoolLamports + cfg.entryLamports * q.entries.get(round).n;
const roundClosedForRuns = round => !!q.payout.get(round);

function parseWallet(w) {
  if (typeof w !== 'string' || w.length > 50) return null;
  try { const pk = new web3.PublicKey(w); return pk.toBase58() === w ? pk : null; } catch { return null; }
}

function base58(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Server error. Try again in a moment.' });
});

// Small per-IP limiter for write endpoints.
const hits = new Map();
function limit(req, res, next) {
  const key = req.ip, t = now();
  const h = hits.get(key) || { n: 0, reset: t + 60000 };
  if (t > h.reset) { h.n = 0; h.reset = t + 60000; }
  h.n++; hits.set(key, h);
  if (h.n > 90) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  next();
}
setInterval(() => { const t = now(); for (const [k, h] of hits) if (t > h.reset) hits.delete(k); }, 60000).unref();

function leaderboard(round, n) {
  return q.board.all(round, n).map(r => ({ wallet: r.wallet, score: r.score }));
}

async function waitForTx(signature, ms) {
  const end = now() + ms;
  while (now() < end) {
    const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (tx) return tx;
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

app.get('/vendor/three.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/three/build/three.min.js')));
app.get('/vendor/web3.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/@solana/web3.js/lib/index.iife.min.js')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    cluster: cfg.cluster, receiver: receiver.toBase58(),
    entryLamports: cfg.entryLamports, basePoolLamports: cfg.basePoolLamports,
    roundMs: cfg.roundMs, skins: cfg.skins,
  });
});

function roundSnapshot() {
  const t = now(), round = roundOf(t);
  const prevRound = round - 1;
  const paid = q.payout.get(prevRound);
  const prevTop = paid ? { wallet: paid.winner, score: paid.score } : leaderboard(prevRound, 1)[0] || null;
  return {
    now: t, round, number: roundNumber(round), endsAt: (round + 1) * cfg.roundMs,
    poolLamports: poolFor(round), entries: q.entries.get(round).n,
    leaderboard: leaderboard(round, 20),
    prev: {
      round: prevRound, number: roundNumber(prevRound),
      winner: prevTop && prevTop.wallet, score: prevTop && prevTop.score,
      lamports: paid ? paid.lamports : poolFor(prevRound),
      status: paid ? paid.status : (prevTop ? 'settling' : 'no_runs'),
      signature: paid && paid.status === 'paid' ? paid.signature : null,
      settlesAt: (prevRound + 1) * cfg.roundMs + cfg.settleDelayMs,
    },
  };
}
app.get('/api/round', (req, res) => res.json(roundSnapshot()));

// Live updates: every open page keeps one stream and gets the round state pushed the moment
// the pool, the leaderboard, the round or a payout changes.
const streams = new Set();
let lastSent = '';
function broadcast(force) {
  if (!streams.size) return;
  const snap = roundSnapshot();
  const key = JSON.stringify({ ...snap, now: 0 });
  if (!force && key === lastSent) return;
  lastSent = key;
  const msg = `data: ${JSON.stringify(snap)}\n\n`;
  for (const res of streams) res.write(msg);
}
app.get('/api/stream', (req, res) => {
  if (streams.size >= 5000) return res.status(503).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`retry: 3000\ndata: ${JSON.stringify(roundSnapshot())}\n\n`);
  streams.add(res);
  req.on('close', () => streams.delete(res));
});
let lastRound = roundOf(now());
setInterval(() => {
  const r = roundOf(now());
  if (r !== lastRound) { lastRound = r; broadcast(true); } else broadcast(false);
}, 1000).unref();
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25000).unref();

/* ---------- built-in wallet support (keys stay in the browser; the server only builds and relays) ---------- */
const RENT_MIN = 890880, FEE = 5000;
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

app.get('/api/me', (req, res) => {
  const pk = parseWallet(req.query.wallet);
  if (!pk) return res.status(400).json({ error: 'Invalid wallet address.' });
  const skins = new Set(['chicken', ...q.owned.all(pk.toBase58()).map(r => r.skin)]);
  res.json({ skins: [...skins] });
});

// Step 1 of a payment: the server builds the exact transfer so it can recognise it later.
app.post('/api/intent', limit, wrap(async (req, res) => {
  const { kind, wallet, skin } = req.body || {};
  const pk = parseWallet(wallet);
  if (!pk) throw new HttpError(400, 'Connect a Solana wallet first.');
  let lamports, skinId = null;
  if (kind === 'entry') {
    lamports = cfg.entryLamports;
  } else if (kind === 'skin') {
    const s = cfg.skins.find(x => x.id === skin);
    if (!s || s.lamports === 0) throw new HttpError(400, 'That character is not for sale.');
    if (q.owned.all(pk.toBase58()).some(r => r.skin === s.id)) throw new HttpError(409, `You already own the ${s.name}.`);
    lamports = s.lamports; skinId = s.id;
  } else throw new HttpError(400, 'Unknown payment type.');

  const reference = web3.Keypair.generate().publicKey;
  const ix = web3.SystemProgram.transfer({ fromPubkey: pk, toPubkey: receiver, lamports });
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: pk, blockhash, lastValidBlockHeight }).add(ix);
  const id = newId();
  q.addIntent.run(id, kind, pk.toBase58(), skinId, lamports, reference.toBase58(),
    tx.serializeMessage().toString('base64'), now(), 'pending');
  res.json({ intentId: id, lamports, tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') });
}));

// Fallback for wallets that can sign but not send: the server relays only the exact transaction it built.
app.post('/api/relay', limit, wrap(async (req, res) => {
  const { intentId, tx } = req.body || {};
  const intent = typeof intentId === 'string' && q.intent.get(intentId);
  if (!intent || intent.status !== 'pending') throw new HttpError(400, 'This payment request has expired. Start again.');
  let parsed, raw;
  try { raw = Buffer.from(String(tx), 'base64'); parsed = web3.Transaction.from(raw); } catch { throw new HttpError(400, 'Could not read the signed transaction.'); }
  if (parsed.serializeMessage().toString('base64') !== intent.message || !parsed.verifySignatures()) {
    throw new HttpError(400, 'The signed transaction does not match the payment request.');
  }
  const signature = await conn.sendRawTransaction(raw).catch(e => { throw new HttpError(400, `Solana rejected the transaction: ${e.message}`); });
  res.json({ signature });
}));

// Step 2: verify the payment on chain, then hand out a run ticket or the skin.
app.post('/api/confirm', limit, wrap(async (req, res) => {
  const { intentId, signature } = req.body || {};
  const intent = typeof intentId === 'string' && q.intent.get(intentId);
  if (!intent) throw new HttpError(404, 'Payment request not found.');
  if (intent.status === 'done') return res.json(JSON.parse(intent.result));
  if (intent.status === 'failed') throw new HttpError(400, 'This payment failed on chain. No SOL was taken.');
  if (typeof signature !== 'string' || signature.length < 60 || signature.length > 100) throw new HttpError(400, 'Invalid transaction signature.');
  const used = q.sigUsed.get(signature);
  if (used && used.intent !== intent.id) throw new HttpError(409, 'That transaction was already used.');

  const tx = await waitForTx(signature, 25000);
  if (!tx) {
    if (now() - intent.created > 10 * 60000) throw new HttpError(400, 'Payment was not found on chain. If SOL left your wallet, contact support with your transaction signature.');
    return res.status(202).json({ pending: true });
  }
  if (tx.meta && tx.meta.err) {
    q.finishIntent.run('failed', signature, null, intent.id);
    throw new HttpError(400, 'This payment failed on chain. No SOL was taken.');
  }
  const msg = tx.transaction.message;
  const keys = (msg.staticAccountKeys || msg.accountKeys).map(k => k.toBase58());
  const ri = keys.indexOf(receiver.toBase58());
  const received = ri >= 0 ? tx.meta.postBalances[ri] - tx.meta.preBalances[ri] : 0;
  if (keys[0] !== intent.wallet || !keys.includes(intent.reference) || received < intent.lamports) {
    throw new HttpError(400, 'That transaction is not the payment we asked for.');
  }

  // Everything below is synchronous, so two confirm calls cannot both get through.
  const fresh = q.intent.get(intent.id);
  if (fresh.status === 'done') return res.json(JSON.parse(fresh.result));
  if (q.sigUsed.get(signature)) throw new HttpError(409, 'That transaction was already used.');
  let result;
  db.exec('BEGIN IMMEDIATE');
  try {
    q.useSig.run(signature, intent.id);
    if (intent.kind === 'entry') {
      const ticketId = newId();
      q.addTicket.run(ticketId, intent.wallet, null, crypto.randomBytes(4).readUInt32LE(0), now());
      result = { kind: 'entry', ticketId };
    } else {
      q.addOwned.run(intent.wallet, intent.skin);
      result = { kind: 'skin', skin: intent.skin };
    }
    q.finishIntent.run('done', signature, JSON.stringify(result), intent.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json(result);
}));

// The seed stays secret until the player presses start, and the clock starts then.
app.post('/api/run/start', limit, wrap(async (req, res) => {
  const { ticketId, skin } = req.body || {};
  const t = typeof ticketId === 'string' && q.ticket.get(ticketId);
  if (!t) throw new HttpError(404, 'Run ticket not found.');
  if (t.status !== 'paid') throw new HttpError(409, 'This paid run was already used.');
  const s = cfg.skins.find(x => x.id === skin);
  if (!s) throw new HttpError(400, 'Unknown character.');
  if (s.lamports > 0 && !q.owned.all(t.wallet).some(r => r.skin === s.id)) {
    throw new HttpError(403, `Buy the ${s.name} before playing with it. Your paid run is still saved.`);
  }
  const started = now(), round = roundOf(started);
  q.startTicket.run(started, round, s.id, t.id);
  broadcast();
  res.json({ seed: t.seed, round, maxTicks: Sim.MAX_TICKS });
}));

app.post('/api/run', limit, wrap(async (req, res) => {
  const { ticketId, inputs, score } = req.body || {};
  const t = typeof ticketId === 'string' && q.ticket.get(ticketId);
  if (!t) throw new HttpError(404, 'Run ticket not found.');
  if (t.status !== 'started') throw new HttpError(409, 'This run was already submitted.');
  q.closeTicket.run('checking', null, t.id);

  const reject = reason => { q.closeTicket.run('rejected', reason, t.id); throw new HttpError(400, reason); };
  const rep = Sim.replay(t.seed, inputs);
  if (!rep.ok) reject('This run could not be verified.');
  if (rep.score !== score) reject('The score did not match the replay of your run.');
  const runSec = rep.ticks / Sim.TPS, elapsed = (now() - t.started) / 1000;
  if (elapsed + 2 < runSec) reject('This run finished faster than real time.');
  if (elapsed > runSec + 25) reject('Ranked runs cannot be paused. This run took too long to submit.');
  if (roundClosedForRuns(t.round)) reject('That round has already been paid out.');

  q.addRun.run(t.id, t.wallet, t.round, rep.score, rep.ticks, now());
  q.closeTicket.run('scored', null, t.id);
  broadcast();
  const board = leaderboard(t.round, 1000);
  const rank = board.findIndex(r => r.wallet === t.wallet) + 1;
  const mine = board[rank - 1];
  res.json({ ok: true, score: rep.score, round: t.round, rank, best: mine ? mine.score : rep.score });
}));

/* ---------- payouts ---------- */
let settling = false;
async function settle() {
  if (settling) return;
  settling = true;
  try {
    const lastClosed = roundOf(now() - cfg.settleDelayMs) - 1;
    for (const { round } of q.unsettledRounds.all(lastClosed)) {
      const top = leaderboard(round, 1)[0];
      if (top) q.addPayout.run(round, top.wallet, top.score, poolFor(round), 'pending', now());
      else q.addPayout.run(round, null, null, 0, 'no_runs', now());
    }
    for (const p of q.openPayouts.all()) await pay(p);
    broadcast();
  } catch (e) {
    console.error('Settlement error:', e.message);
  } finally {
    settling = false;
  }
}

async function pay(p) {
  // A transfer may already be in flight from an earlier attempt. Never send a second one
  // until the first is confirmed failed or its blockhash has expired.
  if (p.status === 'sending' && p.signature) {
    const st = (await conn.getSignatureStatus(p.signature, { searchTransactionHistory: true })).value;
    if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      q.setPayout.run('paid', p.signature, p.last_valid, null, now(), p.round);
      console.log(`Round ${p.round}: paid ${p.lamports / 1e9} SOL to ${p.winner} (${p.signature})`);
      return;
    }
    if (!st || !st.err) {
      const height = await conn.getBlockHeight('confirmed');
      if (height <= p.last_valid) return; // still able to land; check again next pass
    }
    q.setPayout.run('pending', null, null, st && st.err ? JSON.stringify(st.err) : 'expired, retrying', now(), p.round);
  }

  const balance = await conn.getBalance(treasury.publicKey);
  if (balance < p.lamports + 10000) {
    q.setPayout.run('pending', null, null, `Treasury balance too low (${balance / 1e9} SOL)`, now(), p.round);
    console.error(`Round ${p.round}: treasury has ${balance / 1e9} SOL, needs ${p.lamports / 1e9}. Top it up.`);
    return;
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: treasury.publicKey, blockhash, lastValidBlockHeight })
    .add(web3.SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: new web3.PublicKey(p.winner), lamports: p.lamports }));
  tx.sign(treasury);
  const sig = base58(tx.signature);
  q.setPayout.run('sending', sig, lastValidBlockHeight, null, now(), p.round);
  try {
    await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    q.setPayout.run('paid', sig, lastValidBlockHeight, null, now(), p.round);
    console.log(`Round ${p.round}: paid ${p.lamports / 1e9} SOL to ${p.winner} (${sig})`);
  } catch (e) {
    console.error(`Round ${p.round}: payout not confirmed yet (${e.message}). Will re-check.`);
  }
}

setInterval(settle, 15000);
settle();

app.listen(cfg.port, () => {
  console.log(`Crossy running on http://localhost:${cfg.port}`);
  console.log(`Cluster: ${cfg.cluster}`);
  console.log(`Payments go to: ${receiver.toBase58()}`);
  console.log(`Prizes paid from treasury: ${treasury.publicKey.toBase58()}`);
  console.log(`Entry ${cfg.entryLamports / 1e9} SOL, base pool ${cfg.basePoolLamports / 1e9} SOL, rounds every ${cfg.roundMs / 60000} min`);
});
