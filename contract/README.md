# Veyra escrow contract

The contract owns the authoritative batch and payment state. A batch owner deposits exactly the sum of all approved payments in native NEAR or an allowlisted NEP-141 token. The owner or configured agent may start processing and call `process_item`; every transfer is finalized through a private callback.

Failed amounts remain in escrow until the batch completes, then return automatically to the owner. Owners may also cancel a batch when no transfer receipt is in flight.

## Build and test

```bash
cargo install cargo-near
cargo near build non-reproducible-wasm
cargo test
```

## Initialize

```bash
near contract call-function as-transaction <contract.testnet> new \
  json-args '{"agent":"<agent.testnet>","supported_tokens":[{"token_id":"<usdc-token.testnet>","symbol":"USDC","decimals":6},{"token_id":"<usdt-token.testnet>","symbol":"USDT","decimals":6}]}' prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' sign-as <contract.testnet> network-config testnet sign-with-keychain send
```

The contract account should retain a small operational balance to cover storage and the 1 yoctoNEAR deposits required by NEP-141 transfers. Register the contract and every intended recipient with each token contract using `storage_deposit` before funding or paying a token batch.

## Funding

- Native NEAR batches call `create_batch` and attach exactly the sum of all payment amounts.
- USDC/USDt batches call the allowlisted token's `ft_transfer_call`, with Veyra as `receiver_id`. The message contains `recipients`, atomic-unit `amounts`, and an optional memo.
- Invalid messages, totals or token contracts panic inside `ft_on_transfer`, allowing the NEP-141 resolver to return the tokens to the sender.
- Failed payments and cancellations are refunded in the original asset.
