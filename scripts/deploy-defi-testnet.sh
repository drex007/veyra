#!/usr/bin/env bash
set -euo pipefail

required=(OWNER_ID TREASURY_ID USDC_TOKEN_ID USDT_TOKEN_ID LENDING_ID)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name before deploying the DeFi testnet stack."
    exit 1
  fi
done

AGENT_ID="${AGENT_ID:-$OWNER_ID}"
META_POOL_ID="${META_POOL_ID:-meta-v2.pool.testnet}"
TEST_REWARD_BPS="${TEST_REWARD_BPS:-10}"
TOKEN_SUPPLY="${TOKEN_SUPPLY:-1000000000000}"
LENDING_REWARD_RESERVE="${LENDING_REWARD_RESERVE:-100000000}"

cargo build --target wasm32-unknown-unknown --release --manifest-path treasury-contract/Cargo.toml
cargo build --target wasm32-unknown-unknown --release --manifest-path mock-token-contract/Cargo.toml
cargo build --target wasm32-unknown-unknown --release --manifest-path mock-lending-contract/Cargo.toml

TOKEN_WASM="mock-token-contract/target/wasm32-unknown-unknown/release/veyra_mock_token.wasm"
LENDING_WASM="mock-lending-contract/target/wasm32-unknown-unknown/release/veyra_mock_lending.wasm"
TREASURY_WASM="treasury-contract/target/wasm32-unknown-unknown/release/veyra_treasury.wasm"

near contract deploy "$USDC_TOKEN_ID" use-file "$TOKEN_WASM" without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction "$USDC_TOKEN_ID" new json-args "{\"owner_id\":\"$OWNER_ID\",\"total_supply\":\"$TOKEN_SUPPLY\",\"name\":\"Veyra Test USDC\",\"symbol\":\"USDC\",\"decimals\":6}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$USDC_TOKEN_ID" network-config testnet sign-with-keychain send

near contract deploy "$USDT_TOKEN_ID" use-file "$TOKEN_WASM" without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction "$USDT_TOKEN_ID" new json-args "{\"owner_id\":\"$OWNER_ID\",\"total_supply\":\"$TOKEN_SUPPLY\",\"name\":\"Veyra Test USDt\",\"symbol\":\"USDT\",\"decimals\":6}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$USDT_TOKEN_ID" network-config testnet sign-with-keychain send

near contract deploy "$LENDING_ID" use-file "$LENDING_WASM" without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction "$LENDING_ID" new json-args "{\"admin\":\"$OWNER_ID\",\"tokens\":[{\"token_id\":\"$USDC_TOKEN_ID\",\"symbol\":\"USDC\"},{\"token_id\":\"$USDT_TOKEN_ID\",\"symbol\":\"USDT\"}],\"reward_bps\":$TEST_REWARD_BPS}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$LENDING_ID" network-config testnet sign-with-keychain send

near contract deploy "$TREASURY_ID" use-file "$TREASURY_WASM" without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction "$TREASURY_ID" new json-args "{\"owner\":\"$OWNER_ID\",\"agent\":\"$AGENT_ID\",\"meta_pool_id\":\"$META_POOL_ID\",\"burrow_id\":\"$LENDING_ID\",\"supported_tokens\":[{\"token_id\":\"$USDC_TOKEN_ID\",\"symbol\":\"USDC\",\"decimals\":6},{\"token_id\":\"$USDT_TOKEN_ID\",\"symbol\":\"USDT\",\"decimals\":6}]}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$TREASURY_ID" network-config testnet sign-with-keychain send

for token_id in "$USDC_TOKEN_ID" "$USDT_TOKEN_ID"; do
  for account_id in "$TREASURY_ID" "$LENDING_ID"; do
    near contract call-function as-transaction "$token_id" storage_deposit json-args "{\"account_id\":\"$account_id\",\"registration_only\":true}" prepaid-gas '30.0 Tgas' attached-deposit '0.01 NEAR' sign-as "$OWNER_ID" network-config testnet sign-with-keychain send
  done
done

for token_id in "$USDC_TOKEN_ID" "$USDT_TOKEN_ID"; do
  near contract call-function as-transaction "$token_id" ft_transfer json-args "{\"receiver_id\":\"$LENDING_ID\",\"amount\":\"$LENDING_REWARD_RESERVE\",\"memo\":\"Veyra test yield reserve\"}" prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as "$OWNER_ID" network-config testnet sign-with-keychain send
done

echo "Veyra DeFi testnet stack deployed."
echo "NEXT_PUBLIC_TREASURY_CONTRACT_ID=$TREASURY_ID"
echo "NEXT_PUBLIC_META_POOL_CONTRACT_ID=$META_POOL_ID"
echo "NEXT_PUBLIC_BURROW_CONTRACT_ID=$LENDING_ID"
echo "NEXT_PUBLIC_USDC_TOKEN_ID=$USDC_TOKEN_ID"
echo "NEXT_PUBLIC_USDT_TOKEN_ID=$USDT_TOKEN_ID"
