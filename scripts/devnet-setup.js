// Creates a treasury wallet for local testing and asks the devnet faucet for test SOL.
const fs = require('fs');
const path = require('path');
const web3 = require('@solana/web3.js');
const cfg = require('../config');

(async () => {
  if (cfg.cluster === 'mainnet-beta') { console.error('This script is for devnet only.'); process.exit(1); }
  const file = path.resolve(__dirname, '..', cfg.treasuryKeypair);
  let kp;
  if (fs.existsSync(file)) {
    kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
    console.log(`Using existing treasury ${kp.publicKey.toBase58()}`);
  } else {
    kp = web3.Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    console.log(`Created treasury ${kp.publicKey.toBase58()} -> ${file}`);
  }
  const conn = new web3.Connection(cfg.rpcUrl, 'confirmed');
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
    console.log('Airdropped 2 devnet SOL.');
  } catch (e) {
    console.log(`Faucet refused (${e.message.split('\n')[0]}). Get devnet SOL at https://faucet.solana.com for the address above.`);
  }
  console.log(`Treasury balance: ${(await conn.getBalance(kp.publicKey)) / 1e9} SOL`);
})();
