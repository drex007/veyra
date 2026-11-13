# Veyra

**Autonomous payments and policy-protected treasury yield on NEAR.**

Veyra turns a CSV or Excel workbook into a controlled, auditable payment run. Its OpenAI-powered agent analyzes payment risk, deterministic guardrails validate recipient accounts and policy limits, and the NEAR contract creates exactly funded NEAR, USDC or USDt escrow batches. PostgreSQL retains batch and payment history for operational reporting.

The **Treasury Autopilot** extends that workflow into Unstoppable DeFi. An independent vault contract ring-fences upcoming obligations, adds an operator-defined safety buffer and liquidity holdback, and permits only the remaining surplus to move. It can execute NEAR liquid staking through Meta Pool and Burrow-compatible stablecoin lending, reconcile exits, and return capital plus realized yield to the vault. Rates are variable and never treated as guaranteed returns.

Built for the **Autonomous Business**, **Real-World Money** and **Agent Economy** tracks of the 2026 NEAR Hackathon.

## What judges can verify

1. Open the dashboard and choose **New payment**.
2. Select **Use demo payroll** or upload a `.csv`/`.xlsx` workbook with `wallet`, `amount`, optional `token`, and `memo` columns. Blank or missing tokens default to NEAR.
3. Run agent checks. The malformed account is held back with an explanation.
4. Create the batch and start the autonomous run.
5. Observe each payment move through Pending → Processing → Success.
6. Download separate success and failure reports.
7. Open **Treasury autopilot**, select NEAR, USDC or USDT, fund the vault, and save its obligations and reserve policy.
8. Deploy only the on-chain-approved surplus to Meta Pool or the lending adapter, then use **Emergency exit** to reconcile the position back into liquid vault funds.

The payroll path and a read-only DeFi planner work without a wallet. Configure the testnet contracts to enable wallet-signed escrow, funding, policy, deployment, withdrawal and emergency-exit transactions.

## Architecture

```text
CSV / Excel → policy checks → OpenAI risk agent → operator review
                     │                                │
                     └── explained rejections         ▼
                                           multi-asset escrow contract
                                                       │
                                         callback reconciliation
                                                       │
                                 PostgreSQL history + audit CSVs

owner deposit → independent treasury vault → per-asset reserve policy
                                                   │
                                      on-chain deployment capacity
                                                   │
                                 ┌─────────────────┴───────────────┐
                                 ▼                                 ▼
                       Meta Pool liquid stake           Burrow-compatible lending
                             NEAR → stNEAR                 USDC / USDt supply
                                 │                                 │
                                 └──── callbacks + reconciliation ─┘
                                                   │
                                           liquid vault balance
```

- `app/` — Next.js App Router UI and server validation routes
- `components/` — wallet provider and responsive Veyra dashboard
- `lib/agent.ts` — deterministic policy agent and explainable risk decisions
- `lib/openai-agent.ts` — OpenAI Responses API structured risk analysis
- `lib/excel.ts` — Excel workbook ingestion
- `lib/db.ts` — PostgreSQL persistence and schema initialization
- `lib/near-rpc.ts` — testnet account and contract reads
- `lib/defi.ts` — allowlisted strategy registry and deterministic reserve policy
- `lib/defi-market.ts` — live Burrow rate adapter with failure-safe fallback
- `contract/` — Rust escrow contract, callback accounting and unit tests
- `treasury-contract/` — policy-protected vault, Meta Pool/Burrow execution and reconciliation
- `mock-token-contract/` — six-decimal NEP-141 test USDC/USDt
- `mock-lending-contract/` — Burrow-compatible testnet lending adapter with configurable yield
- `scripts/deploy-defi-testnet.sh` — repeatable testnet DeFi stack deployment
- `tests/` — amount-safety and agent-policy tests

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Leaving `NEXT_PUBLIC_CONTRACT_ID` blank enables demo mode.

OpenAI and PostgreSQL are optional during local UI development. Set `OPENAI_API_KEY` and `DATABASE_URL` in `.env.local` to enable them. The API key is server-only and must never use a `NEXT_PUBLIC_` prefix.

For a local PostgreSQL database:

```bash
createdb veyra
psql veyra < db/schema.sql
```

The application also creates the required tables idempotently on its first configured database operation.

## Quality checks

```bash
npm test
npm run typecheck
npm run build
```

The Rust contracts require Rust and the `wasm32-unknown-unknown` target. The payroll build command also uses `cargo-near`:

```bash
cargo test --manifest-path contract/Cargo.toml
cargo test --manifest-path treasury-contract/Cargo.toml
cargo test --manifest-path mock-token-contract/Cargo.toml
cargo test --manifest-path mock-lending-contract/Cargo.toml
cargo near build non-reproducible-wasm --manifest-path contract/Cargo.toml
cargo build --target wasm32-unknown-unknown --release --manifest-path treasury-contract/Cargo.toml
```

## Testnet deployment

1. Create and fund a NEAR testnet account for the contract.
2. Install the current NEAR CLI and `cargo-near`.
3. Set the deployer and agent IDs:

```bash
export CONTRACT_ID=veyra.<your-account>.testnet
export AGENT_ID=<your-account>.testnet
bash scripts/deploy-contract.sh
```

4. Copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_CONTRACT_ID`, and restart the app.

For token payments, also set `NEXT_PUBLIC_USDC_TOKEN_ID` and `NEXT_PUBLIC_USDT_TOKEN_ID` to the same allowlisted NEP-141 contracts used to initialize Veyra. Token recipients must be registered with the relevant token contract.

To deploy the complete DeFi test stack, create five funded testnet subaccounts and run:

```bash
export OWNER_ID=<your-account>.testnet
export TREASURY_ID=treasury.<your-account>.testnet
export USDC_TOKEN_ID=usdc.<your-account>.testnet
export USDT_TOKEN_ID=usdt.<your-account>.testnet
export LENDING_ID=lending.<your-account>.testnet
bash scripts/deploy-defi-testnet.sh
```

The script deploys test USDC/USDt, a protocol-compatible lending adapter, and the Veyra vault. It points the NEAR route at Meta Pool testnet (`meta-v2.pool.testnet`), performs token storage registration, and prefunds the lending adapter's test-yield reserve. Copy the printed `NEXT_PUBLIC_*` values to `.env.local`.

## Contract guarantees

- The attached deposit must equal the sum of recipient amounts.
- NEP-141 funding must arrive through `ft_transfer_call` from an allowlisted token, and the transferred amount must equal the token batch total.
- Mixed spreadsheets are split into independent NEAR, USDC and USDt batches so decimals and escrow balances cannot mix.
- Batches accept at most 200 payments.
- Only the owner or configured agent can process items.
- Only the owner can cancel.
- Transfer results are recorded only from private callbacks.
- Failed payment amounts are automatically refunded in their original asset when reconciliation finishes.
- Cancellation is blocked while transfer receipts are in flight.
- Payroll escrow and yield capital live in separate contracts and accounting domains.
- The vault recomputes deployment capacity on-chain from obligations, safety buffer, liquidity holdback, liquid funds and existing principal.
- Only the owner can fund, withdraw or change policy; the owner or configured agent can deploy and exit within that policy.
- A global operation lock prevents overlapping vault/protocol calls, and private callbacks reconcile every external result.
- Lending exits query the vault's actual NEP-141 balance before crediting principal or realized yield.

## MVP limitations

- NEAR, USDC and USDt payments are supported; any cross-chain conversion through NEAR Intents remains a roadmap item.
- The testnet stack uses real Meta Pool testnet for NEAR and a Burrow-compatible mock adapter for deterministic stablecoin demos. A production Burrow deployment must be configured and integration-tested before mainnet use.
- APYs are variable market observations and can change rapidly; Veyra does not promise returns.
- Browser wallet approval is required for contract transactions.
- OpenAI analysis augments—but cannot override—the deterministic payment guardrails.
- The database history API needs wallet-session authentication before storing sensitive production payroll metadata; the hackathon MVP assumes test data.
- Contract storage is subsidized by its account in the hackathon MVP.
- The contracts have unit tests but have not received a production security audit; do not deploy real funds before one.

## Submission pitch

> Veyra is an autonomous treasury operator that turns a spreadsheet into secure on-chain payroll, protects the next operating cycle, and routes only verified surplus toward transparent NEAR yield strategies.
