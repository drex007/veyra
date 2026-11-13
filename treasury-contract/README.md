# Veyra Treasury contract

This contract is the policy boundary for Veyra's yield capital. It is deliberately separate from the payroll escrow contract.

## Supported routes

- `NEAR` → Meta Pool `deposit_and_stake` / `liquid_unstake`
- `USDC` and `USDT` → NEP-141 `ft_transfer_call` / Burrow-compatible `execute(Withdraw)`

Every asset has obligations, a safety-buffer basis-point value and a liquidity-holdback basis-point value. `get_deployment_capacity` recomputes the maximum allowed deployment from liquid balance and existing principal; callers cannot override it.

## Main methods

- `deposit_near` and `ft_on_transfer` fund the vault.
- `set_asset_policy` updates reserve inputs.
- `deploy_meta_pool` and `deploy_burrow` move approved surplus.
- `exit_meta_pool` and `exit_burrow` reconcile capital, realized yield and realized loss.
- `emergency_exit_meta_pool` and `emergency_exit_burrow` unwind a full recorded position.
- `withdraw_near` and `withdraw_token` return liquid funds to the owner.
- `get_treasury` returns the dashboard snapshot.

## Build and test

```bash
cargo test --manifest-path treasury-contract/Cargo.toml
cargo build --target wasm32-unknown-unknown --release --manifest-path treasury-contract/Cargo.toml
```

The contract is an unaudited hackathon implementation. Use testnet assets only until it has protocol integration tests and an independent security review.
