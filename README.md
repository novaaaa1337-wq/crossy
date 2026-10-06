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
| API | `lib/app.js`, `lib/db.js`, `config.js` | Builds payments, checks them on chain, replays runs, records winners |
| Entry points | `api/index.js` (Vercel), `local-server.js` (anywhere else) | Run the same API |

**Wallets.** Every player gets a Solana wallet made in their browser on first visit. The private key is stored only in
that browser and never reaches the server. Players add SOL by sending it to their address, and can withdraw, export
the key (it imports into Phantom or Solflare) or switch to another key from the Wallet button. The page nags players
to export once their wallet holds SOL, because clearing browser data deletes the key.

**Paying.** Entries (0.05 SOL) and character purchases go to the receiving wallet set in `RECEIVER_WALLET`.
The server builds each transfer with a unique reference key, the browser signs it, and the server confirms it on
chain before handing out a run ticket or a character. Each signature can only be used once. Characters must be
owned to be played, in practice and in ranked, and the server checks ownership when a ranked run starts.

**Live updates.** Every open page refreshes the round every 2 seconds, and right away when the tab comes back,
so pool, timer, leaderboard and payouts stay in step for everyone. Rounds are numbered from #1, starting with the round the server first ran in.

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

Needs Node 22 or newer. With no `DATABASE_URL`, a built-in Postgres keeps data in `./.pglite`.

```bash
npm install
cp .env.example .env      # set ADMIN_TOKEN to a long random string
npm start                 # http://localhost:3000
npm test                  # replay determinism and forgery checks (no network)
```

## Deploy on Vercel

1. Import the GitHub repo in Vercel. `vercel.json` already sets the build, the static site (`public/`) and the API
   function (`api/index.js`). Leave the framework preset as Other.
2. In the project, open **Storage**, create a **Neon** Postgres database and connect it to the project.
   That adds `DATABASE_URL` for you. Without it the game still loads, but the page says "No database connected".
3. In **Settings → Environment Variables**, add:
   - `ADMIN_TOKEN`: a long random password for `/admin.html`
   - `RPC_URL`: your paid Solana RPC URL (Helius, Triton, QuickNode). The public one is rate-limited.
   - optional: `RECEIVER_WALLET`, `ENTRY_SOL`, `BASE_POOL_SOL`, `ROUND_MINUTES` and skin prices (see `.env.example`)
4. Redeploy (Deployments → latest → Redeploy) so the new variables apply.
5. Add `crossy.fun` under **Settings → Domains**.

To check it: `/api/config` returns JSON, and `/api/round` shows round #1 with a 2 SOL pool.

Other hosts (Railway, Render, a VPS) also work: set `DATABASE_URL` and run `npm start`.

### Before opening it up

- Play one cheap round first: set `ENTRY_SOL=0.001` and `BASE_POOL_SOL=0.001`, then deposit, pay, play,
  pay yourself from `/admin.html` and withdraw. Then set the real prices.

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
