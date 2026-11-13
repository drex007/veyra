# Security model

## Trust boundaries

- The browser prepares and displays payment intent but does not decide final on-chain state.
- The server validation route reads public RPC state and never handles wallet private keys.
- The OpenAI API key and PostgreSQL connection string are server-only environment variables.
- OpenAI risk analysis is advisory; deterministic policy checks remain authoritative.
- The wallet signs all owner actions.
- The contract is authoritative for escrow balances and payment outcomes.
- The configured agent can process approved items but cannot change recipients, amounts or cancel a batch.

## Invariants

1. `attached_deposit == sum(items.amount)` at creation.
2. An item can be processed only from `Pending`.
3. Only the private callback can set `Success` or `Failed`.
4. A successful transfer reduces escrow exactly once.
5. The owner receives failed/unspent escrow after completion or cancellation.
6. Cancellation cannot race an in-flight transfer.
7. Blank payment tokens resolve to NEAR; unknown token names are rejected rather than silently converted.
8. NEP-141 deposits are accepted only from administrator-allowlisted token contracts.
9. Every token batch preserves its own decimals, escrow balance and refund asset.

## Treasury Autopilot controls

- Payroll escrow and yield capital are isolated in separate contracts, so a strategy cannot spend an active payroll batch.
- The protected reserve equals upcoming obligations plus the configured safety buffer; a separate percentage of remaining surplus is held liquid.
- The vault calculates deployment capacity on-chain. If the reserve is underfunded—or existing principal already fills the investable envelope—the deployable amount is zero.
- Only owner-allowlisted NEP-141 contracts can fund stablecoin balances. Token transfers from any other predecessor are rejected.
- Only the owner can fund, withdraw, update policy, rotate the agent or change protocol accounts. The owner or configured agent can deploy and exit positions.
- A single-operation lock prevents overlapping withdrawal, deployment and exit promises. It is released only by private callbacks.
- Failed outbound calls restore internal liquid accounting. Meta Pool callbacks record stNEAR receipt units, while lending exits query the actual NEP-141 balance before crediting receipts and realized yield or loss.
- Emergency-exit methods unwind the complete recorded Meta Pool or lending position with owner authorization.
- Yield rates are display data, never authorization data. A stale or failed market feed cannot trigger an allocation.
- Liquid staking, lending, stablecoins and Intents each add protocol-specific smart-contract, liquidity, market and counterparty risks.

## Production hardening after the MVP

- Charge measured storage deposits rather than subsidizing storage.
- Add a two-step agent rotation and emergency pause.
- Add explicit slippage policy and an oracle-independent lower bound for Meta Pool exits; the MVP owner currently supplies `min_expected_near` for ordinary exits and uses zero only for emergency exits.
- Use a restricted function-call key for unattended agent execution.
- Add integration tests with NEAR sandbox, real protocol test contracts and adversarial concurrent calls.
- Audit both escrow and treasury contracts before mainnet deployment.
- Verify NEP-413 wallet signatures before allowing production history reads or writes.
- Redact or tokenize sensitive payroll memos before model analysis when required by company policy.
