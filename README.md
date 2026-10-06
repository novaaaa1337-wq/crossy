# Crossy

Hop across roads, rivers and rail lines. Every 15 minutes the best ranked score wins the round's pool:
2 SOL from the treasury plus 0.05 SOL for every ranked entry. Practice mode is free and never touches the leaderboard.
Characters (skins) are bought with SOL.

## How it works

| Piece | File | Job |
| --- | --- | --- |
| Game rules | `public/sim.js` | Deterministic 60 Hz simulation shared by browser and server |
| Game client | `public/app.js`, `index.html`, `style.css` | Three.js rendering, wallet connection, menus, leaderboard |
| Server | `server.js`, `config.js` | Builds payments, checks them on chain, replays runs, pays winners |

**Wallets.** Every player gets a Solana wallet made in their browser on first visit. The private key is stored only in
that browser and never reaches the server. Players add SOL by sending it to their address, and can withdraw, export
the key (it imports into Phantom or Solflare) or switch to another key from the Wallet button. The page nags players
to export once their wallet holds SOL, because clearing browser data deletes the key.

**Paying.** Entries (0.05 SOL) and character purchases go to the receiving wallet set in RECEIVER_WALLET.
The server builds each transfer with a unique reference key, the browser signs it, and the server confirms it on
chain before handing out a run ticket or a character. Each signature can only be used once. Characters must be
owned to be played, in practice and in ranked, and the server checks ownership when a ranked run starts.

**Live updates.** Every open page holds a live stream (/api/stream). Pool, timer, leaderboard and payouts are
pushed to everyone the moment they change. If the stream drops, the page asks every 5 seconds instead.
Rounds are numbered from #1, starting with the round the server first ran in.

**Scoring.** Each ranked run gets a secret seed from the server when the player presses start. The browser records
only the player's inputs (tick number and direction). On submit, the server replays those inputs on the same
seed and uses the score the replay produces. Runs that finish faster than real time, or that sat paused for more
than 25 seconds, are rejected. Each ticket can be used once.

**Payouts.** Runs can last up to 10 minutes, so a round is settled 11 minutes after it closes. The top wallet
(ties go to whoever got the score first) is paid automatically from the treasury wallet (TREASURY_KEYPAIR), which
must hold enough SOL for each pool, since entry fees go to the receiving wallet instead. Payouts are written to the
database before they are sent, so a crash or restart never sends the same prize twice. If the treasury runs low,
the payout waits and the server logs a warning.

## Run it locally (devnet)

Needs Node 22.13 or newer.

```bash
npm install
cp .env.example .env
npm run setup:devnet      # creates treasury.json and asks the faucet for devnet SOL
npm start                 # http://localhost:3000
```

If the faucet refuses, paste the treasury address into https://faucet.solana.com. To test with a wallet, switch
Phantom or Solflare to devnet and fund it from the same faucet.

Checks:

```bash
npm test                  # replay determinism and forgery checks (no network)
npm run e2e               # full paid run on devnet against the running server (needs devnet SOL)
```

## Going live on crossy.fun

Crossy is a long-running server with a database file, a payout timer and live connections.
**It does not run on Vercel or other serverless hosts.** Those stop the server between requests and wipe its files.
Use a host that keeps a process running and gives it a disk: Railway, Render (with a disk) or Fly.io.

### Railway

1. railway.com, then New Project, then Deploy from GitHub repo, and pick this repo. It runs Unknown command: "start"


Did you mean one of these?
  npm star # Mark your favorite packages
  npm stars # View packages marked as favorites
  npm start # Start a package
To see a list of supported npm commands, run:
  npm help on its own.
2. Open the service, then Settings, then Volumes, and add a volume mounted at .
3. Under Variables, add:
   -    -    -  your paid RPC URL (Helius, Triton, QuickNode)
   -    -  the prize wallet's private key (base58, as exported from Phantom)
   -  if the build picks an older Node
4. Settings, then Networking: add the custom domain  and create the DNS record Railway shows at your domain registrar.
   Remove the domain from Vercel first.
5. Check the deploy logs for  and the two wallet addresses.

### Before opening it up

- Fund the treasury wallet with enough SOL for upcoming pools, and keep only that much in it.
- Play one cheap round first: set  and , then deposit, pay, play,
  wait for the payout and withdraw. Then set the real prices.
- Back up . It holds tickets, runs, character ownership and payout records.

## Before real money goes in

- **The house pays the base 2 SOL every round that has at least one ranked run.** That can be up to 96 rounds,
  or 192 SOL a day, while bringing in as little as 0.05 SOL per round. Make sure that is the plan, or change
  `BASE_POOL_SOL` (for example `0` for a pool made only of entry fees).
- **Bots.** The replay check stops faked scores. It does not stop a script that plays the game itself in real time.
  Expect this to be the main attack once the prize is worth more than the entry fee. Options if it shows up:
  limit entries per wallet per round, require a minimum wallet age, or review top runs before paying.
- **Law.** Paid entry plus a cash prize is regulated as gambling or a prize contest in many places. Some places
  allow it only for games of pure skill, and some ban it outright. Get advice for the places your players are in,
  and block regions if you need to.
