// All money amounts are kept in lamports (1 SOL = 1,000,000,000 lamports) to avoid rounding errors.
function sol(s) {
  const [i, f = ''] = String(s).trim().split('.');
  return Number(BigInt(i || '0') * 1000000000n + BigInt((f + '000000000').slice(0, 9)));
}

const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  cluster: env.CLUSTER || 'mainnet-beta',               // 'mainnet-beta' or 'devnet'
  rpcUrl: env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  // Receives every entry fee and skin purchase.
  receiver: env.RECEIVER_WALLET || '6s88p25hjVgESfoa9mSwqwmyDV2AT2hrVWgGZ6SLiTt7',
  // Password for /admin.html, where round winners are listed and payouts are marked as sent.
  adminToken: env.ADMIN_TOKEN || '',

  entryLamports: sol(env.ENTRY_SOL || '0.05'),          // price of one ranked run, added to the pool
  basePoolLamports: sol(env.BASE_POOL_SOL || '2'),      // added to every round's prize; you pay it by hand
  roundMs: (Number(env.ROUND_MINUTES) || 15) * 60000,
  // Runs can last up to 10 minutes, so a round is paid out 11 minutes after it closes.
  settleDelayMs: 11 * 60000,

  skins: [
    { id: 'chicken', name: 'Chicken', price: '0' },
    { id: 'frog', name: 'Frog', price: env.SKIN_FROG_SOL || '0.1' },
    { id: 'penguin', name: 'Penguin', price: env.SKIN_PENGUIN_SOL || '0.15' },
    { id: 'fox', name: 'Fox', price: env.SKIN_FOX_SOL || '0.25' },
    { id: 'robot', name: 'Robot', price: env.SKIN_ROBOT_SOL || '0.5' },
  ].map(s => ({ id: s.id, name: s.name, lamports: sol(s.price) })),

  sol,
};
