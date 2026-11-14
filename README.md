# Veyra

**Autonomous payments and policy-protected treasury yield on NEAR.**

Veyra turns a CSV or Excel workbook into a controlled, auditable payment run. Its OpenAI-powered Treasury Readiness Agent chooses investigation tools, classifies every payment as ready, review or held, and records an observe → reason → act → verify trace. Deterministic guardrails remain authoritative over recipient accounts, policy limits and agent-requested holds, while the NEAR contract creates exactly funded NEAR, USDC or USDt escrow batches. PostgreSQL retains batch, payment and agent-run history for operational reporting.

The **Treasury Autopilot** extends that workflow into Unstoppable DeFi. An independent vault contract ring-fences upcoming obligations, adds an operator-defined safety buffer and liquidity holdback, and permits only the remaining surplus to move. It can execute NEAR liquid staking through Meta Pool and Burrow-compatible stablecoin lending, reconcile exits, and return capital plus realized yield to the vault. Rates are variable and never treated as guaranteed returns.

Built for the **Autonomous Business**, **Real-World Money** and **Agent Economy** tracks of the 2026 NEAR Hackathon.

## Current testnet status

| Item | Value |
| --- | --- |
| Network | NEAR testnet |
| Payment contract | [`veyra-payments.testnet`](https://testnet.nearblocks.io/address/veyra-payments.testnet) |
| Processing agent | `veyra-payments.testnet` using a restricted function-call key |
| Agent permissions | Only `start_processing` and `process_item`, with a 1 NEAR gas allowance |
| Enabled payment asset | Native NEAR |
| Contract batch limit | 200 recipients per on-chain batch; Veyra splits runs of up to 1,000 |
| Verified live batches | Batches `0` and `1`; latest batch `1` paid 0.003 NEAR across three successful transfers while holding the invalid row |

The contract code supports allowlisted NEP-141 tokens, but this deployment currently has no USDC or USDt contracts allowlisted. Configure and allowlist test-token contracts before attempting stablecoin payments. The Treasury Autopilot contract is a separate deployment and is not required for the payment demo.

## What judges can verify

1. Open the landing page, select **Launch the demo**, and choose **New payment** in the dashboard.
2. Select **Use demo payroll** or upload a `.csv`/`.xlsx` workbook with `wallet`, `amount`, optional `token`, and `memo` columns. Blank or missing tokens default to NEAR.
3. Run agent checks. Expand **Agent activity** to inspect the selected tools and the malformed account's enforced hold.
4. Approve the funding bundle once, then start autonomous settlement without recipient-level wallet prompts.
5. Observe the server agent move each payment through Pending → Processing → Success.
6. Open **Batch history**, select **View** on the completed run, and inspect every recipient, amount, memo, status, contract batch ID and funding transaction.
7. Ask the Failure Recovery Agent to reconcile outcomes, inspect constrained recovery actions, and download separate success and failure reports.
8. Open **Treasury autopilot**, select NEAR, USDC or USDT, fund the vault, and save its obligations and reserve policy.
9. Deploy only the on-chain-approved surplus to Meta Pool or the lending adapter, then use **Emergency exit** to reconcile the position back into liquid vault funds.

The payroll path and a read-only DeFi planner work without a wallet. Configure the testnet contracts to enable wallet-signed escrow, funding, policy, deployment, withdrawal and emergency-exit transactions.

## Payment flow

1. The operator connects an existing NEAR wallet through Meteor.
2. The operator uploads a CSV or Excel workbook.
3. Deterministic controls validate address format, account existence, amounts, duplicates, token support and the configured per-recipient limit.
4. When enabled, OpenAI uses Responses API function tools to choose relevant readiness investigations. A deterministic fallback runs the same bounded tool contract when OpenAI is unavailable.
5. The backend verifies every tool-requested hold, computes authoritative ready/review/held dispositions, and stores the activity trace. The model cannot override a deterministic rejection.
6. The operator reviews the approved and held rows.
7. The wallet funds the exact approved run. Veyra splits files larger than the live contract limit and submits the funding transactions through one wallet signing flow. Rejected rows never enter escrow.
8. The configured server agent starts each on-chain batch and submits `process_item` calls with its own restricted key. The owner does not approve recipient-level settlement transactions.
9. Private callbacks record each transfer result, close the batch and reconcile any failed or unused escrow.
10. Batch History presents the application run and its underlying contract batches as one audit record. The **View** action exposes the complete recipient ledger and transaction references without another chain call.
11. The Failure Recovery Agent checks available receipts and escrow snapshots, pauses unresolved outcomes, and prepares a retry only for a conclusively failed transfer. Retry preparation never submits a transaction and always requires fresh owner approval and funding.

NEAR displays the final recipient payment as a **transfer receipt** beneath the `process_item` transaction. The top-level agent call correctly shows a zero deposit because the contract is spending funds already held in escrow.

## Payment file format

CSV and `.xlsx` files use the following columns:

```csv
wallet,amount,token,memo
alice.testnet,0.001,NEAR,Design payout
bob.testnet,0.001,NEAR,Engineering payout
wrong wallet address,0.001,NEAR,Intentionally invalid test row
```

| Column | Required | Notes |
| --- | --- | --- |
| `wallet` | Yes | NEAR account ID; `recipient` and `account` are accepted aliases |
| `amount` | Yes | Positive decimal in the selected asset's display units |
| `token` | No | `NEAR`, `USDC` or `USDT`; blank safely defaults to `NEAR` |
| `memo` | No | Operational context analyzed by the payment agent |

A Veyra payment run may contain up to 1,000 rows. The current contract stores at most 200 recipients per on-chain batch, so a 300-recipient file becomes two immutable escrow batches inside one application run.

The repository includes [`public/sample-payments.csv`](public/sample-payments.csv) and [`veyra-4-user-ai-test.csv`](veyra-4-user-ai-test.csv). The latter has three verified testnet recipients and one intentionally invalid address.

## Batch history and audit trail

Open **Batch history** from the dashboard sidebar to review previous payment runs. Each history row summarizes the batch name, creation time, valid-recipient count, settled count, total amount and current status.

Select **View** to open the complete batch record:

- every uploaded recipient, including rejected rows;
- amount, token, memo or validation issue, and settlement status;
- application batch ID and underlying contract batch/item indexes;
- owner, execution mode, funding assets and NearBlocks transaction links;
- total, recipient, settled and attention-required counts; and
- a full CSV export for reconciliation.

The payment ledger scrolls independently, so runs containing hundreds of recipients remain usable on desktop and mobile. Press `Escape`, select the close button, or select outside the panel to close it. PostgreSQL provides cross-session history when `DATABASE_URL` is configured; the local demo path keeps its limited history in browser storage.

## Architecture

```text
CSV / Excel → deterministic controls → Treasury Readiness Agent → operator review
                      │                  │ tools + trace          │
                      └── enforced holds ┴────────────────────────▼
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

- `app/page.tsx` — public Veyra landing page and hackathon product narrative
- `app/dashboard/` — interactive payment and treasury workspace
- `app/api/` — server validation, persistence, contract, agent and DeFi routes
- `components/` — wallet provider and responsive Veyra dashboard
- `lib/agent.ts` — deterministic policy agent and explainable risk decisions
- `lib/openai-agent.ts` — OpenAI Responses API structured risk analysis
- `lib/treasury-agent.ts` — bounded tool-calling readiness loop, token registration checks and verified holds
- `lib/payment-investigation.ts` — chain-evidence reconciliation, failure classification and approval-gated retry preparation
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

## Quick start

Requirements:

- Node.js 20 or newer
- npm
- PostgreSQL 15 or newer for persistent batch history
- Meteor Wallet for signed testnet transactions
- Rust, the `wasm32-unknown-unknown` target and `cargo-near` only when rebuilding contracts

```bash
npm install
cp .env.example .env.local
npm run db:setup
npm run dev
```

Open `http://localhost:3000` for the public landing page. The working application is available at `http://localhost:3000/dashboard`; every landing-page CTA links there.

`npm run db:setup` creates an isolated development cluster under `.veyra-postgres/`, starts it on `127.0.0.1:5433`, creates the `veyra` database and applies [`db/schema.sql`](db/schema.sql). It uses trust authentication only on the local loopback development server; use managed credentials and TLS in production.

Database lifecycle commands:

```bash
npm run db:status
npm run db:start
npm run db:stop
```

Leaving `NEXT_PUBLIC_CONTRACT_ID` blank enables the local demo path. To use the deployed payment contract, set it to `veyra-payments.testnet` and restart Next.js after changing environment variables.

## Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK` | Browser | NEAR network; use `testnet` for the current deployment |
| `NEXT_PUBLIC_NEAR_RPC_URL` | Browser/server | NEAR JSON-RPC endpoint |
| `NEXT_PUBLIC_CONTRACT_ID` | Browser/server | Payment escrow contract account |
| `NEXT_PUBLIC_TREASURY_CONTRACT_ID` | Browser/server | Optional Treasury Autopilot vault |
| `NEXT_PUBLIC_EXPLORER_URL` | Browser | Explorer base URL; use `https://testnet.nearblocks.io` |
| `NEXT_PUBLIC_USDC_TOKEN_ID` | Browser/server | Allowlisted six-decimal USDC NEP-141 contract |
| `NEXT_PUBLIC_USDT_TOKEN_ID` | Browser/server | Allowlisted six-decimal USDt NEP-141 contract |
| `NEXT_PUBLIC_META_POOL_CONTRACT_ID` | Browser/server | Meta Pool strategy account |
| `NEXT_PUBLIC_BURROW_CONTRACT_ID` | Browser/server | Lending adapter or production integration account |
| `OPENAI_API_KEY` | Server only | Enables structured AI payment analysis |
| `OPENAI_MODEL` | Server only | Responses API model used by the analyst |
| `VEYRA_AGENT_ACCOUNT_ID` | Server only | Must match the payment contract's configured processing agent |
| `VEYRA_AGENT_PRIVATE_KEY` | Server only | Restricted function-call key used for `start_processing` and `process_item`; never expose it to the browser |
| `DATABASE_URL` | Server only | PostgreSQL connection string |
| `DATABASE_SSL` | Server only | Set to `disable` only for local development |

Never prefix the OpenAI key or database URL with `NEXT_PUBLIC_`. Restart `npm run dev` after changing `.env` or `.env.local`.

Supabase transaction-pooler URLs normally use port `6543`. Veyra detects that port and disables prepared statements automatically; use `DATABASE_SSL=require` for hosted databases. The included local PostgreSQL URL uses `127.0.0.1` deliberately because the development server binds IPv4 loopback.

### Restricted settlement key

The current testnet deployment uses `veyra-payments.testnet` as both the contract account and the configured processing-agent account. The application does **not** use the account's administrator key. It signs settlement calls with a separate function-call key whose public key is `ed25519:13uFDkDtWM3VrosTZUW8WxS51KoMtf5dDnY7cmMCgSuf`.

For local testnet operation, configure:

```dotenv
VEYRA_AGENT_ACCOUNT_ID=veyra-payments.testnet
VEYRA_AGENT_PRIVATE_KEY=ed25519:<restricted-function-call-private-key>
```

Keep the private key in an ignored local environment file or the deployment platform's secret manager. Never commit it, expose it through a `NEXT_PUBLIC_` variable, or substitute the wallet recovery phrase or full-access administrator key.

To rotate the agent key:

1. Generate a new Ed25519 keypair locally.
2. Add only its public key to the agent account as a function-call access key restricted to receiver `veyra-payments.testnet` and methods `start_processing,process_item`.
3. Give it a bounded gas allowance appropriate for the expected batch volume.
4. Replace `VEYRA_AGENT_PRIVATE_KEY`, restart the server and confirm `/api/agent/execute` reports `configured: true`.
5. Process a small test batch successfully, then remove the old restricted public key from the account.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Application health check |
| `/api/validate` | POST | RPC checks, deterministic controls, tool-calling readiness run and optional OpenAI analysis |
| `/api/batches` | GET/POST | PostgreSQL batch history and persistence |
| `/api/investigate` | POST | Failure recovery, reconciliation, receipt/escrow evidence and retry preparation |
| `/api/contract/config` | GET | Live payment-contract configuration |
| `/api/contract/batch` | GET | Final on-chain batch and item outcomes used for callback verification |
| `/api/agent/execute` | GET/POST | Server-agent availability and bounded settlement chunks |
| `/api/defi/strategies` | GET | Allowlisted strategies plus current market observations |
| `/api/defi/treasury` | GET | Live Treasury Autopilot state when configured |

## Test the complete payment path

1. Run `npm run db:setup` and `npm run dev`.
2. Use a clean browser profile with Meteor Wallet and connect `0xveektor.testnet` or another funded testnet account.
3. Upload [`veyra-4-user-ai-test.csv`](veyra-4-user-ai-test.csv).
4. Keep **Use OpenAI analysis** enabled and run the checks.
5. Confirm that three rows are approved, one malformed address is held, and the approved total is 0.003 NEAR.
6. Select **Create & fund batch** and approve the exact escrow deposit.
7. Start autonomous settlement. The configured server agent submits processing transactions; no recipient-level wallet approvals are requested.
8. Confirm the batch is complete, open **Batch history**, select **View**, and inspect the recipient ledger.
9. Export the batch CSV and inspect the funding and settlement receipt trees on NearBlocks testnet.

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

### Existing payment-control deployment

- Account: [`veyra-payments.testnet`](https://testnet.nearblocks.io/address/veyra-payments.testnet)
- Deploy transaction: [`98wDf3s6zPN23ext21gja8mW6weMfkD6h4CzZNEyM7St`](https://testnet.nearblocks.io/txns/98wDf3s6zPN23ext21gja8mW6weMfkD6h4CzZNEyM7St)
- Initialization transaction: [`69zStvRRp5z7M61J2wiT5jJmSsUzAMNUCtYHUn3QJc2P`](https://testnet.nearblocks.io/txns/69zStvRRp5z7M61J2wiT5jJmSsUzAMNUCtYHUn3QJc2P)
- Agent update transaction: [`HkUKuDgr8UrMTEiuT5XrUXwxTMc8qLP8AwbAiGQKQr5b`](https://testnet.nearblocks.io/txns/HkUKuDgr8UrMTEiuT5XrUXwxTMc8qLP8AwbAiGQKQr5b)
- Administrator: `veyra-payments.testnet`
- Agent: `veyra-payments.testnet`
- Restricted agent key: `ed25519:13uFDkDtWM3VrosTZUW8WxS51KoMtf5dDnY7cmMCgSuf` (`start_processing`, `process_item`, 1 NEAR allowance)

### Deploy another payment contract

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

## Troubleshooting

### `/api/batches` returns `500`

PostgreSQL is not reachable or its credentials do not match. For the included local database, run:

```bash
npm run db:setup
npm run db:status
```

The schema initializer now clears a failed initialization attempt, so the API can recover after PostgreSQL becomes available. A database failure returns `500`; malformed batch JSON returns `400`.

For Supabase, copy the complete pooler URL from the project dashboard, keep the pooler username exactly as supplied, set `DATABASE_SSL=require`, and confirm that outbound port `6543` is allowed on the machine running Next.js.

### `/api/contract/config` briefly returns `502`

This route depends on the public NEAR testnet RPC. A retry that returns `200` indicates a transient RPC failure. Persistent errors usually mean `NEXT_PUBLIC_CONTRACT_ID`, the RPC URL or the selected network is incorrect.

### The explorer shows `Deposit: 0` for a payment

Open the transaction's **Receipts** section and expand the `TRANSFER` action. `process_item` attaches no new funds; the contract transfers the recipient amount from its existing escrow. Always use [NearBlocks testnet](https://testnet.nearblocks.io), not the mainnet or retired explorer.

### OpenAI silently falls back to policy analysis

Confirm both `OPENAI_API_KEY` and `OPENAI_MODEL` are set in a server-only environment file, restart Next.js, and inspect the server log. The deterministic policy engine remains active if the model is unavailable.

## Contract guarantees

- The attached deposit must equal the sum of recipient amounts.
- NEP-141 funding must arrive through `ft_transfer_call` from an allowlisted token, and the transferred amount must equal the token batch total.
- Mixed spreadsheets are split into independent NEAR, USDC and USDt batches so decimals and escrow balances cannot mix.
- Batches accept at most 200 payments.
- Only the owner or configured agent can process items.
- Only the owner can cancel.
- The AI can request a pre-funding hold but cannot release a deterministic hold, edit an approved recipient or amount, sign a wallet action, or execute a retry.
- A retry plan is blocked unless the prior transfer is conclusively failed in available chain evidence, and a prepared plan still requires a new owner-approved transaction.
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
- The owner approves funding, but recipient settlement uses the configured server agent. Use a restricted NEAR function-call access key with a small allowance rather than the agent account's full-access key in production.
- OpenAI analysis augments—but cannot override—the deterministic payment guardrails.
- The database history API needs wallet-session authentication before storing sensitive production payroll metadata; the hackathon MVP assumes test data.
- Contract storage is subsidized by its account in the hackathon MVP.
- The contracts have unit tests but have not received a production security audit; do not deploy real funds before one.

## Submission pitch

> Veyra is an autonomous treasury operator that turns a spreadsheet into secure on-chain payroll, protects the next operating cycle, and routes only verified surplus toward transparent NEAR yield strategies.
