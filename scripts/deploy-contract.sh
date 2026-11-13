#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CONTRACT_ID:-}" ]]; then
  echo "Set CONTRACT_ID to an existing NEAR testnet account."
  exit 1
fi

if [[ -z "${AGENT_ID:-}" ]]; then
  AGENT_ID="$CONTRACT_ID"
fi

if [[ -z "${USDC_TOKEN_ID:-}" || -z "${USDT_TOKEN_ID:-}" ]]; then
  echo "Set USDC_TOKEN_ID and USDT_TOKEN_ID to the NEP-141 contracts for the selected network."
  exit 1
fi

INIT_ARGS="{\"agent\":\"$AGENT_ID\",\"supported_tokens\":[{\"token_id\":\"$USDC_TOKEN_ID\",\"symbol\":\"USDC\",\"decimals\":6},{\"token_id\":\"$USDT_TOKEN_ID\",\"symbol\":\"USDT\",\"decimals\":6}]}"

cargo near build non-reproducible-wasm --manifest-path contract/Cargo.toml
near contract deploy "$CONTRACT_ID" use-file contract/target/near/veyra_contract/veyra_contract.wasm without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction "$CONTRACT_ID" new json-args "$INIT_ARGS" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$CONTRACT_ID" network-config testnet sign-with-keychain send

# The receiver contract must be registered with each NEP-141 token before ft_transfer_call funding.
near contract call-function as-transaction "$USDC_TOKEN_ID" storage_deposit json-args "{\"account_id\":\"$CONTRACT_ID\",\"registration_only\":true}" prepaid-gas '30.0 Tgas' attached-deposit '0.01 NEAR' sign-as "$CONTRACT_ID" network-config testnet sign-with-keychain send
near contract call-function as-transaction "$USDT_TOKEN_ID" storage_deposit json-args "{\"account_id\":\"$CONTRACT_ID\",\"registration_only\":true}" prepaid-gas '30.0 Tgas' attached-deposit '0.01 NEAR' sign-as "$CONTRACT_ID" network-config testnet sign-with-keychain send
