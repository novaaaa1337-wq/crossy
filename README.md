# Crossy

Hop across roads, rivers and rail lines. Every 15 minutes the best ranked score wins the round's pool:
2 SOL plus 0.05 SOL for every ranked entry. Practice mode is free and never touches the leaderboard.
Characters (skins) are bought with SOL.

## How it works

| Piece | File | Job |
| --- | --- | --- |
| Game rules | `public/sim.js` | Deterministic 60 Hz simulation shared by browser and server |
| Game client | `public/app.js`, `index.html`, `style.css` | Three.js rendering, built-in wallet, menus, leaderboard |
| Admin page | `public/admin.html` | Lists each round's winner and marks prizes as paid |
| Server | `server.js`, `config.js` | Builds payments, checks them on chain, replays runs, records winners |

**Wallets.** Every player gets a Solana wallet made in their browser on first visit. The private key is stored only in
that browser and never reaches the server. Players add SOL by sending it to their address, and can withdraw, export
the key (it imports into Phantom or Solflare) or switch to another key from the Wallet button. The page nags players
to export once their wallet holds SOL, because clearing browser data deletes the key.

**Paying.** Entries (0.05 SOL) and character purchases go to the receiving wallet set in `RECEIVER_WALLET`.
The server builds each transfer with a unique reference key, the browser signs it, and the server confirms it on
chain before handing out a run ticket or a character. Each signature can only be used once. Characters must be
owned to be played, in practice and in ranked, and the server checks ownership when a ranked run starts.

**Live updates.** Every open page holds a live stream (`/api/stream`). Pool, timer, leaderboard and payouts are
pushed to everyone the moment they change. If the stream drops, the page asks every 5 seconds instead.
Rounds are numbered from #1, starting with the round the server first ran in.

**Scoring.** Each ranked run gets a secret seed from the server when the player presses start. The browser records
only the player's inputs (tick number and direction). On submit, the server replays those inputs on the same
seed and uses the score the replay produces. Runs that finish faster than real time, or that sat paused for more
than 25 seconds, are rejected. Each ticket can be used once.

**Payouts (by hand).** Runs can last up to 10 minutes, so a round becomes final 11 minutes after it closes. The
server then records the winner (ties go to whoever got the score first) and the amount owed, and logs it. To pay:

1. Open `/admin.html` and enter your `ADMIN_TOKEN`.
2. Copy the winner's address and send the amount shown from any wallet you control.
3. Paste that transaction's signature and press Mark paid. The server checks on chain that at least the owed
   amount reached the winner, then the site shows the round as paid with a link to the transaction.

Until then, players see "Prize is being sent" under the previous round.

## Run it locally

Needs Node 22.13 or newer.

```bash
npm install
cp .env.example .env      # set ADMIN_TOKEN to a long random string
npm start                 # http://localhost:3000
```

```bash
npm test                  # replay determinism and forgery checks (no network)
```

## Going live on crossy.fun

Crossy is a long-running server with a database file and live connections.
**It does not run on Vercel or other serverless hosts.** Those stop the server between requests and wipe its files,
so tickets, scores and owned characters would disappear.
Use a host that keeps a process running and gives it a disk: Railway, Render (with a disk) or Fly.io.

### Railway

1. On railway.com: New Project, then Deploy from GitHub repo, and pick this repo. It runs `npm start` on its own.
2. Open the service, then Settings, then Volumes, and add a volume mounted at `/data`.
3. Under Variables, add:
   - `DB_PATH=/data/crossy.db`
   - `CLUSTER=mainnet-beta`
   - `RPC_URL=` your paid RPC URL (Helius, Triton, QuickNode)
   - `RECEIVER_WALLET=6s88p25hjVgESfoa9mSwqwmyDV2AT2hrVWgGZ6SLiTt7`
   - `ADMIN_TOKEN=` a long random password for `/admin.html`
   - `NODE_VERSION=22` if the build picks an older Node
4. Settings, then Networking: add the custom domain `crossy.fun` and create the DNS record Railway shows at your
   domain registrar. Remove the domain from Vercel first.
5. Check the deploy logs for `Crossy running`.

### Before opening it up

- Play one cheap round first: set `ENTRY_SOL=0.001` and `BASE_POOL_SOL=0.001`, then deposit, pay, play,
  pay yourself from `/admin.html` and withdraw. Then set the real prices.
- Back up `/data/crossy.db`. It holds tickets, runs, character ownership and the list of prizes owed.

## Before real money goes in

- **You owe the base 2 SOL every round that has at least one ranked run.** That can be up to 96 rounds,
  or 192 SOL a day, while bringing in as little as 0.05 SOL per round. Make sure that is the plan, or change
  `BASE_POOL_SOL` (for example `0` for a pool made only of entry fees).
- **Pay promptly.** Players see the owed prize on the site until it is marked paid.
- **Bots.** The replay check stops faked scores. It does not stop a script that plays the game itself in real time.
  Expect this to be the main attack once the prize is worth more than the entry fee. Paying by hand lets you look
  at a winner before paying; other options are limiting entries per wallet per round or requiring a minimum wallet age.
- **Law.** Paid entry plus a cash prize is regulated as gambling or a prize contest in many places. Some places
  allow it only for games of pure skill, and some ban it outright. Get advice for the places your players are in,
  and block regions if you need to.
