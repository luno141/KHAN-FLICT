# Relic Rush

Relic Rush is a compact dungeon RPG MVP built for Monad testnet. The playable loop is off-chain for responsiveness: play as the Vault Warden, clear a small relic run in Phaser, collect loot, manage your inventory, preview premium artifacts, list them in a marketplace UI, and test your build in a PvP-ready mock duel flow.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Phaser 3
- PostgreSQL + Prisma
- Solidity + Hardhat
- ethers.js

## What Is Playable Today

- Character selection with Warrior, Rogue, and Mage
- One dungeon room with movement, enemy combat, loot drops, and victory/defeat states
- Inventory with equip, unequip, and consumable use
- **Real on-chain minting** of premium artifacts as ERC-721s on Monad
- **On-chain marketplace** with listing and purchasing via the smart contract
- **On-chain run ledger** recording victory runs on Monad for leaderboard-ready tracking
- **Relic Forge** — pay a forge fee in MON to craft new premium artifacts on-chain
- **Monad performance UX** — tx hashes, confirmation time tracking (ms), and explorer links
- PvP arena stub with mock duel simulation and persisted match history
- Wallet connection and Monad network status with auto-add chain support

## On-Chain Features (3 Contracts)

### `RelicRushArtifactMarket` (ERC-721 + Marketplace)
- Mints premium artifacts as NFTs directly from inventory
- Players approve and list minted NFTs for sale in MON
- Buyers purchase listings with native MON transfer
- Reentrancy protection, excess refunds, cancel support

### `RelicRushRunLedger` (Lightweight ledger)
- Records dungeon run results (floor reached + score) on-chain
- Tracks per-player best score
- Designed for minimal gas — called automatically after victory runs

### `RelicRushRelicForge` (Paid crafting)
- Players pay a 0.001 MON forge fee to mint a random premium relic
- Demo-grade randomness (documented — not production-safe)
- Owner can update forge fee and withdraw accumulated fees

## Persistence Behavior

When `DATABASE_URL` is configured, the API routes use PostgreSQL through Prisma.

When `DATABASE_URL` is missing, the app falls back to an in-memory mock store so the MVP stays playable locally. This keeps the vertical slice usable while still shipping the real Prisma schema and server routes.

## Setup

```bash
cp .env.example .env
npm install
```

Fill in the manual values inside `.env`:

- `DATABASE_URL` for PostgreSQL
- `PRIVATE_KEY` for Monad deployments
- `NEXT_PUBLIC_RELIC_RUSH_MARKET_ADDRESS` after deployment
- `NEXT_PUBLIC_RELIC_RUSH_LEDGER_ADDRESS` after deployment
- `NEXT_PUBLIC_RELIC_RUSH_FORGE_ADDRESS` after deployment
- `NEXT_PUBLIC_MONAD_EXPLORER_URL` if you want explorer links

## Prisma Setup

Generate the client:

```bash
npm run prisma:generate
```

Push the schema into PostgreSQL:

```bash
npm run prisma:push
```

## Local Run

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Contract Workflow

Compile and sync all contract ABIs into the frontend:

```bash
npm run compile
```

Run contract tests (9 tests: Market + RunLedger + RelicForge):

```bash
npm test
```

Local Hardhat deployment (deploys all 3 contracts):

```bash
npm run node
npm run deploy:local
```

Monad testnet deployment:

```bash
npm run deploy:monad
```

After deploy, add the printed addresses to your `.env`:

```env
NEXT_PUBLIC_RELIC_RUSH_MARKET_ADDRESS=0x...
NEXT_PUBLIC_RELIC_RUSH_LEDGER_ADDRESS=0x...
NEXT_PUBLIC_RELIC_RUSH_FORGE_ADDRESS=0x...
```

## What Judges See

1. **Monad speed** — every on-chain action shows confirmation time in milliseconds
2. **Explorer links** — tx hashes link to the Monad block explorer
3. **Real NFTs** — premium artifacts are actual ERC-721 tokens on Monad
4. **Network card** — sidebar shows chain info and recent action history
5. **Relic Forge** — a unique on-chain crafting loop unique to this game

## Notes

- Hardhat warns on Node `25.8.1`. Use Node `22.10.0+` LTS for safer reproduction.
- `MONAD_RPC_URL` and chain ID defaults are set from Monad docs at the time of implementation.
- `NEXT_PUBLIC_MONAD_EXPLORER_URL` is intentionally manual.
- Relic Forge uses demo-grade randomness (block-based). Not suitable for production use.
