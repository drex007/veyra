# Veyra — submission copy

## One-line pitch

Veyra is an autonomous treasury operator that turns a spreadsheet into secure on-chain payroll, protects operating reserves, and deploys only verified surplus into NEAR DeFi.

## Problem

Crypto payroll still asks an operator to validate addresses, send many individual transfers and manually reconcile failures. One bad row can waste time or funds, while existing batch tools provide little autonomy or explanation.

## Solution

Veyra gives operators a policy-controlled payment and treasury agent. The operator supplies a CSV or Excel workbook and constraints; deterministic checks validate every row, an OpenAI model highlights semantic anomalies, PostgreSQL retains the operating history, and a NEAR contract escrows and reconciles approved NEAR, USDC and USDt transfers. A missing token choice safely defaults to NEAR. A separate vault protects upcoming obligations and safety liquidity before allowing surplus into Meta Pool staking or Burrow-compatible stablecoin lending.

## Why NEAR

- Human-readable account IDs make payroll recipients understandable.
- Asynchronous promises and callbacks let the contract observe each transfer receipt.
- Low-cost settlement supports operational payment batches.
- Function-call keys provide a natural path toward a constrained, non-custodial agent operator.

## Tracks

- Primary: Autonomous Business
- Secondary: Real-World Money
- Additional: Agent Economy and Unstoppable DeFi

## Demo script (2 minutes)

1. Show the empty dashboard and create a new payment.
2. Load the sample payroll file.
3. Point out the maximum-payment and duplicate-account guardrails.
4. Run checks and show the malformed wallet being rejected with a reason.
5. Create the escrow batch and start the agent.
6. Watch transfer statuses resolve.
7. Download both audit reports and show the on-chain transaction link in contract mode.
8. Open Treasury Autopilot, fund the NEAR vault and set upcoming obligations plus the reserve buffer.
9. Show that Veyra exposes only the calculated surplus, then sign a Meta Pool deployment.
10. Switch to USDC, demonstrate the Burrow-compatible lending route, and emergency-exit the position back into liquid vault funds.

## Suggested X post

Built Veyra at #NEARHackathon — an autonomous payroll + DeFi treasury agent. Upload CSV/XLSX, let AI flag risk, escrow exact NEAR/USDC/USDt payments, protect operating reserves, then route only verified surplus to transparent yield. @NEARProtocol
