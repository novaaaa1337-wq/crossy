// End-to-end check against a running server on devnet: pays for a run with a throwaway
// player wallet, plays it with a bot, submits it, and tries a forged score.
// Usage: npm start (in one terminal), then npm run e2e
const fs = require('fs');
const path = require('path');
const web3 = require('@solana/web3.js');
const Sim = require('../public/sim.js');
const cfg = require('../config');

const BASE = process.env.E2E_URL || `http://localhost:${cfg.port}`;
const conn = new web3.Connection(cfg.rpcUrl, 'confirmed');
const keyFile = path.resolve(__dirname, '..', 'e2e-player.json');

async function api(p, body) {
  const r = await fetch(BASE + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok && r.status !== 202) throw new Error(`${p}: ${j.error}`);
  return { status: r.status, ...j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function payEntry(player) {
  const intent = await api('/api/intent', { kind: 'entry', wallet: player.publicKey.toBase58() });
  const tx = web3.Transaction.from(Buffer.from(intent.tx, 'base64'));
  tx.partialSign(player);
  const { signature } = await api('/api/relay', { intentId: intent.intentId, tx: tx.serialize().toString('base64') });
  for (;;) {
    const r = await api('/api/confirm', { intentId: intent.intentId, signature });
    if (r.status !== 202) return { ...r, signature, intentId: intent.intentId };
  }
}

async function playBot(seed) {
  const g = Sim.createGame(seed, { quiet: true });
  const start = Date.now();
  while (g.step()) {
    if (g.tick % 10 === 0) g.input(Math.random() < .8 ? 0 : (Math.random() < .5 ? 2 : 3));
    const ahead = g.tick / Sim.TPS * 1000 - (Date.now() - start);
    if (ahead > 0) await sleep(ahead); // play in real time, like a person would
  }
  return g;
}

(async () => {
  let player;
  if (fs.existsSync(keyFile)) player = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile))));
  else { player = web3.Keypair.generate(); fs.writeFileSync(keyFile, JSON.stringify(Array.from(player.secretKey))); }
  console.log('Player wallet', player.publicKey.toBase58());
  let bal = await conn.getBalance(player.publicKey);
  if (bal < 0.2e9) {
    try { await conn.confirmTransaction(await conn.requestAirdrop(player.publicKey, 1e9), 'confirmed'); }
    catch (e) { console.log('Airdrop refused. Fund this address at https://faucet.solana.com and run again.'); process.exit(1); }
    bal = await conn.getBalance(player.publicKey);
  }
  console.log('Player balance', bal / 1e9, 'SOL');

  const before = await api('/api/round');
  const paid = await payEntry(player);
  console.log('1. Paid entry, got ticket:', paid.ticketId.slice(0, 8), 'tx', paid.signature.slice(0, 16) + '…');

  const again = await api('/api/confirm', { intentId: paid.intentId, signature: paid.signature });
  console.log('2. Re-confirming the same payment returns the same ticket:', again.ticketId === paid.ticketId);

  const start = await api('/api/run/start', { ticketId: paid.ticketId });
  const g = await playBot(start.seed);
  console.log(`3. Bot played ${(g.tick / 60).toFixed(1)} s, score ${g.p.maxRow}, ended by ${g.p.kind}`);

  const res = await api('/api/run', { ticketId: paid.ticketId, inputs: g.inputs, score: g.p.maxRow });
  console.log(`4. Submitted: verified score ${res.score}, rank #${res.rank}`);

  const after = await api('/api/round');
  console.log(`5. Pool went from ${before.poolLamports / 1e9} to ${after.poolLamports / 1e9} SOL; leaderboard rows: ${after.leaderboard.length}`);

  try { await api('/api/run', { ticketId: paid.ticketId, inputs: g.inputs, score: g.p.maxRow }); console.log('6. FAIL: ticket reused'); }
  catch (e) { console.log('6. Reusing the ticket is refused:', e.message); }

  const paid2 = await payEntry(player);
  const start2 = await api('/api/run/start', { ticketId: paid2.ticketId });
  const g2 = await playBot(start2.seed);
  try { await api('/api/run', { ticketId: paid2.ticketId, inputs: g2.inputs, score: g2.p.maxRow + 500 }); console.log('7. FAIL: forged score accepted'); }
  catch (e) { console.log('7. Forged score is refused:', e.message); }
})().catch(e => { console.error('E2E failed:', e.message); process.exit(1); });
