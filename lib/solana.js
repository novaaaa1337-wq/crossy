// Minimal Solana access with no libraries: address checks plus a few calls to Solana's public
// network. Transactions are built and signed in the player's browser; the server only relays them
// and reads results back.
const crypto = require('crypto');

const ENDPOINT = 'https://api.mainnet-beta.solana.com';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function base58Decode(str) {
  let n = 0n;
  for (const c of str) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return Uint8Array.from(out);
}
// A Solana address is 32 bytes written in base58.
function isAddress(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  const b = base58Decode(s);
  return !!b && b.length === 32;
}
// A fresh random address, used to tag each payment so it can be recognised on chain.
const randomAddress = () => base58Encode(crypto.randomBytes(32));

let nextId = 1;
async function call(method, params) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  if (res.status === 429) throw new Error('Solana is busy right now. Try again in a few seconds.');
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`Solana returned an unreadable answer (${res.status}).`);
  if (body.error) {
    const detail = body.error.data && body.error.data.err;
    const text = `${body.error.message || 'Solana returned an error.'}${detail ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`;
    if (/AccountNotFound|InsufficientFunds|insufficient (funds|lamports)|no record of a prior credit/i.test(text)) {
      throw new Error('Your wallet does not have enough SOL for this and the network fee. Add SOL and try again.');
    }
    throw new Error(text);
  }
  return body.result;
}

const latestBlockhash = async () => (await call('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
const balance = async address => (await call('getBalance', [address, { commitment: 'confirmed' }])).value;
const sendTransaction = base64 => call('sendTransaction', [base64, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
async function signatureStatus(sig) {
  return (await call('getSignatureStatuses', [[sig], { searchTransactionHistory: true }])).value[0];
}
// Returns { ok, err, keys, signers, change(address) } for a confirmed transaction, or null if not found yet.
async function getTransaction(sig) {
  const tx = await call('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx) return null;
  const accounts = tx.transaction.message.accountKeys.map(k => (typeof k === 'string' ? { pubkey: k, signer: false } : k));
  const keys = accounts.map(k => k.pubkey);
  return {
    err: tx.meta && tx.meta.err,
    keys,
    feePayer: keys[0],
    // How many lamports an address gained (or lost) in this transaction.
    change: address => {
      const i = keys.indexOf(address);
      return i < 0 ? 0 : tx.meta.postBalances[i] - tx.meta.preBalances[i];
    },
  };
}

module.exports = { ENDPOINT, isAddress, randomAddress, latestBlockhash, balance, sendTransaction, signatureStatus, getTransaction };
