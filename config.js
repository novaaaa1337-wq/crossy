// All money amounts are kept in lamports (1 SOL = 1,000,000,000 lamports) to avoid rounding errors.
function sol(s) {
  const t = String(s).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(t)) throw new Error(`"${s}" is not an amount of SOL`);
  const [i, f = ''] = t.split('.');
  return Number(BigInt(i) * 1000000000n + BigInt((f + '000000000').slice(0, 9)));
}

// Settings pasted into a hosting dashboard often carry stray quotes or spaces.
const clean = v => (v == null ? '' : String(v).trim().replace(/^["']|["']$/g, '').trim());
const env = name => clean(process.env[name]);

// A bad setting never stops the server: it falls back to the default and is listed on /api/health.
const problems = [];
function money(name, fallback) {
  const v = env(name);
  if (!v) return sol(fallback);
  try { return sol(v); } catch { problems.push(`${name}="${v}" is not an amount of SOL, so ${fallback} is used.`); return sol(fallback); }
}

module.exports = {
  port: Number(env('PORT')) || 3000,
  cluster: env('CLUSTER') || 'mainnet-beta',               // 'mainnet-beta' or 'devnet'
  rpcUrl: env('RPC_URL') || 'https://api.mainnet-beta.solana.com',
  // Receives every entry fee and skin purchase.
  receiver: env('RECEIVER_WALLET') || '6s88p25hjVgESfoa9mSwqwmyDV2AT2hrVWgGZ6SLiTt7',
  // Password for /admin.html, where round winners are listed and payouts are marked as sent.
  adminToken: env('ADMIN_TOKEN'),

  entryLamports: money('ENTRY_SOL', '0.05'),             // price of one ranked run, added to the pool
  basePoolLamports: money('BASE_POOL_SOL', '2'),         // added to every round's prize; you pay it by hand
  roundMs: (Number(env('ROUND_MINUTES')) || 15) * 60000,
  // Runs can last up to 10 minutes, so a round is paid out 11 minutes after it closes.
  settleDelayMs: 11 * 60000,

  skins: [
    { id: 'chicken', name: 'Chicken', lamports: 0 },
    { id: 'frog', name: 'Frog', lamports: money('SKIN_FROG_SOL', '0.1') },
    { id: 'penguin', name: 'Penguin', lamports: money('SKIN_PENGUIN_SOL', '0.15') },
    { id: 'fox', name: 'Fox', lamports: money('SKIN_FOX_SOL', '0.25') },
    { id: 'robot', name: 'Robot', lamports: money('SKIN_ROBOT_SOL', '0.5') },
  ],

  problems,
  sol,
};
