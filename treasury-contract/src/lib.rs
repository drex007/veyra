use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue, PromiseResult,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const PROTOCOL_GAS: Gas = Gas::from_tgas(80);
const FT_GAS: Gas = Gas::from_tgas(45);
const BPS_DENOMINATOR: u128 = 10_000;
const NEAR_SYMBOL: &str = "NEAR";
const META_STRATEGY: &str = "meta-pool-stnear";

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    Balances,
    Policies,
    Positions,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenConfig {
    pub token_id: AccountId,
    pub symbol: String,
    pub decimals: u8,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct AssetPolicy {
    pub obligations: U128,
    pub safety_buffer_bps: u16,
    pub liquidity_holdback_bps: u16,
}

impl Default for AssetPolicy {
    fn default() -> Self {
        Self {
            obligations: U128(0),
            safety_buffer_bps: 2_000,
            liquidity_holdback_bps: 3_000,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum PositionStatus {
    Active,
    Closed,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Position {
    pub strategy_id: String,
    pub asset: String,
    pub provider_id: AccountId,
    pub principal: U128,
    pub receipt_units: U128,
    pub total_deposited: U128,
    pub total_withdrawn: U128,
    pub realized_yield: U128,
    pub realized_loss: U128,
    pub status: PositionStatus,
    pub updated_at_ms: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AssetSnapshot {
    pub symbol: String,
    pub decimals: u8,
    pub token_id: Option<AccountId>,
    pub liquid: U128,
    pub invested: U128,
    pub total: U128,
    pub reserve_target: U128,
    pub deployable: U128,
    pub policy: AssetPolicy,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TreasurySnapshot {
    pub owner: AccountId,
    pub agent: AccountId,
    pub meta_pool_id: AccountId,
    pub burrow_id: AccountId,
    pub operation_in_flight: bool,
    pub assets: Vec<AssetSnapshot>,
    pub positions: Vec<Position>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MetaLiquidUnstakeResult {
    pub near: U128,
    pub fee: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BurrowExecuteArgs {
    pub actions: Vec<BurrowAction>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub enum BurrowAction {
    Withdraw {
        token_id: AccountId,
        max_amount: U128,
    },
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait TreasuryCallbacks {
    fn on_native_withdraw(&mut self, amount: U128) -> bool;
    fn on_token_withdraw(&mut self, symbol: String, amount: U128) -> bool;
    fn on_meta_deposit(&mut self, amount: U128) -> bool;
    fn on_meta_exit(&mut self, shares: U128) -> bool;
    fn on_burrow_deposit(&mut self, symbol: String, amount: U128) -> bool;
    fn on_burrow_exit(&mut self, symbol: String, amount: U128) -> PromiseOrValue<bool>;
    fn on_burrow_balance(&mut self, symbol: String, amount: U128) -> bool;
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[ext_contract(ext_meta_pool)]
#[allow(dead_code)]
trait MetaPool {
    fn deposit_and_stake(&mut self) -> U128;
    fn liquid_unstake(&mut self, st_near_to_burn: U128, min_expected_near: U128)
        -> MetaLiquidUnstakeResult;
}

#[ext_contract(ext_burrow)]
#[allow(dead_code)]
trait Burrow {
    fn execute(&mut self, actions: Vec<BurrowAction>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VeyraTreasury {
    owner: AccountId,
    agent: AccountId,
    meta_pool_id: AccountId,
    burrow_id: AccountId,
    supported_tokens: Vec<TokenConfig>,
    balances: LookupMap<String, u128>,
    policies: LookupMap<String, AssetPolicy>,
    positions: LookupMap<String, Position>,
    position_ids: Vec<String>,
    operation_in_flight: bool,
}

#[near]
impl VeyraTreasury {
    #[init]
    pub fn new(
        owner: AccountId,
        agent: AccountId,
        meta_pool_id: AccountId,
        burrow_id: AccountId,
        supported_tokens: Vec<TokenConfig>,
    ) -> Self {
        assert!(!env::state_exists(), "Treasury is already initialized");
        let mut seen = vec![NEAR_SYMBOL.to_string()];
        for token in &supported_tokens {
            assert!(!token.symbol.trim().is_empty(), "Token symbol is required");
            assert!(token.decimals > 0, "Token decimals must be positive");
            let normalized = token.symbol.to_ascii_uppercase();
            assert!(!seen.contains(&normalized), "Duplicate token symbol");
            seen.push(normalized);
        }
        Self {
            owner,
            agent,
            meta_pool_id,
            burrow_id,
            supported_tokens,
            balances: LookupMap::new(StorageKey::Balances),
            policies: LookupMap::new(StorageKey::Policies),
            positions: LookupMap::new(StorageKey::Positions),
            position_ids: vec![],
            operation_in_flight: false,
        }
    }

    #[payable]
    pub fn deposit_near(&mut self) {
        self.assert_owner();
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Attach NEAR to deposit");
        self.add_balance(NEAR_SYMBOL, amount);
        Self::log_event("treasury_deposit", NEAR_SYMBOL, amount);
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        _msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(sender_id, self.owner, "Only the treasury owner can fund the vault");
        assert!(amount.0 > 0, "Deposit amount must be positive");
        let token = self
            .supported_tokens
            .iter()
            .find(|item| item.token_id == env::predecessor_account_id())
            .cloned()
            .unwrap_or_else(|| env::panic_str("Token is not allowlisted"));
        self.add_balance(&token.symbol, amount.0);
        Self::log_event("treasury_deposit", &token.symbol, amount.0);
        PromiseOrValue::Value(U128(0))
    }

    pub fn set_asset_policy(
        &mut self,
        symbol: String,
        obligations: U128,
        safety_buffer_bps: u16,
        liquidity_holdback_bps: u16,
    ) {
        self.assert_owner();
        let symbol = self.assert_asset(&symbol);
        assert!(safety_buffer_bps <= 20_000, "Safety buffer cannot exceed 200%");
        assert!(liquidity_holdback_bps <= 10_000, "Liquidity holdback cannot exceed 100%");
        self.policies.insert(
            &symbol,
            &AssetPolicy {
                obligations,
                safety_buffer_bps,
                liquidity_holdback_bps,
            },
        );
        Self::log_event("policy_updated", &symbol, obligations.0);
    }

    pub fn withdraw_near(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        self.assert_idle();
        self.sub_balance(NEAR_SYMBOL, amount.0);
        self.operation_in_flight = true;
        Promise::new(self.owner.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_native_withdraw(amount),
            )
    }

    pub fn withdraw_token(&mut self, symbol: String, amount: U128) -> Promise {
        self.assert_owner();
        self.assert_idle();
        let token = self.token_by_symbol(&symbol);
        self.sub_balance(&token.symbol, amount.0);
        self.operation_in_flight = true;
        ext_ft::ext(token.token_id)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(FT_GAS)
            .ft_transfer(self.owner.clone(), amount, Some("Veyra treasury withdrawal".to_string()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_token_withdraw(token.symbol, amount),
            )
    }

    pub fn deploy_meta_pool(&mut self, amount: U128) -> Promise {
        self.assert_operator();
        self.assert_idle();
        assert!(amount.0 > 0, "Deployment amount must be positive");
        assert!(amount.0 <= self.deployment_capacity(NEAR_SYMBOL), "Amount exceeds the policy-approved NEAR surplus");
        self.sub_balance(NEAR_SYMBOL, amount.0);
        self.operation_in_flight = true;
        ext_meta_pool::ext(self.meta_pool_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(amount.0))
            .with_static_gas(PROTOCOL_GAS)
            .deposit_and_stake()
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_meta_deposit(amount),
            )
    }

    pub fn exit_meta_pool(&mut self, st_near_amount: U128, min_expected_near: U128) -> Promise {
        self.assert_operator();
        self.assert_idle();
        let position = self.position_or_default(
            META_STRATEGY,
            NEAR_SYMBOL,
            self.meta_pool_id.clone(),
        );
        assert!(st_near_amount.0 > 0, "Exit amount must be positive");
        assert!(st_near_amount.0 <= position.receipt_units.0, "Not enough stNEAR position units");
        self.operation_in_flight = true;
        ext_meta_pool::ext(self.meta_pool_id.clone())
            .with_static_gas(PROTOCOL_GAS)
            .liquid_unstake(st_near_amount, min_expected_near)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_meta_exit(st_near_amount),
            )
    }

    pub fn emergency_exit_meta_pool(&mut self) -> Promise {
        self.assert_owner();
        let position = self
            .positions
            .get(&META_STRATEGY.to_string())
            .unwrap_or_else(|| env::panic_str("No Meta Pool position exists"));
        self.exit_meta_pool(position.receipt_units, U128(0))
    }

    pub fn deploy_burrow(&mut self, symbol: String, amount: U128) -> Promise {
        self.assert_operator();
        self.assert_idle();
        let token = self.token_by_symbol(&symbol);
        assert!(amount.0 > 0, "Deployment amount must be positive");
        assert!(amount.0 <= self.deployment_capacity(&token.symbol), "Amount exceeds the policy-approved token surplus");
        self.sub_balance(&token.symbol, amount.0);
        self.operation_in_flight = true;
        ext_ft::ext(token.token_id)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(PROTOCOL_GAS)
            .ft_transfer_call(
                self.burrow_id.clone(),
                amount,
                Some(format!("Veyra {} lending supply", token.symbol)),
                "".to_string(),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_burrow_deposit(token.symbol, amount),
            )
    }

    pub fn exit_burrow(&mut self, symbol: String, amount: U128) -> Promise {
        self.assert_operator();
        self.assert_idle();
        let token = self.token_by_symbol(&symbol);
        let strategy_id = Self::burrow_strategy_id(&token.symbol);
        let position = self
            .positions
            .get(&strategy_id)
            .unwrap_or_else(|| env::panic_str("No lending position exists"));
        assert!(amount.0 > 0, "Exit amount must be positive");
        assert!(amount.0 <= position.principal.0, "Exit exceeds lending principal");
        self.operation_in_flight = true;
        ext_burrow::ext(self.burrow_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(PROTOCOL_GAS)
            .execute(vec![BurrowAction::Withdraw {
                token_id: token.token_id,
                max_amount: amount,
            }])
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_burrow_exit(token.symbol, amount),
            )
    }

    pub fn emergency_exit_burrow(&mut self, symbol: String) -> Promise {
        self.assert_owner();
        let normalized = self.assert_asset(&symbol);
        let position = self
            .positions
            .get(&Self::burrow_strategy_id(&normalized))
            .unwrap_or_else(|| env::panic_str("No lending position exists"));
        self.exit_burrow(normalized, position.principal)
    }

    #[private]
    pub fn on_native_withdraw(&mut self, amount: U128) -> bool {
        self.operation_in_flight = false;
        let succeeded = Self::promise_succeeded();
        if !succeeded {
            self.add_balance(NEAR_SYMBOL, amount.0);
        }
        succeeded
    }

    #[private]
    pub fn on_token_withdraw(&mut self, symbol: String, amount: U128) -> bool {
        self.operation_in_flight = false;
        let succeeded = Self::promise_succeeded();
        if !succeeded {
            self.add_balance(&symbol, amount.0);
        }
        succeeded
    }

    #[private]
    pub fn on_meta_deposit(&mut self, amount: U128) -> bool {
        self.operation_in_flight = false;
        let shares = Self::promise_json::<U128>();
        if let Some(shares) = shares {
            let mut position = self.position_or_default(
                META_STRATEGY,
                NEAR_SYMBOL,
                self.meta_pool_id.clone(),
            );
            position.principal = U128(position.principal.0.checked_add(amount.0).expect("Principal overflow"));
            position.receipt_units = U128(position.receipt_units.0.checked_add(shares.0).expect("Receipt overflow"));
            position.total_deposited = U128(position.total_deposited.0.checked_add(amount.0).expect("Deposit overflow"));
            position.status = PositionStatus::Active;
            position.updated_at_ms = env::block_timestamp_ms();
            self.save_position(position);
            Self::log_event("strategy_deployed", NEAR_SYMBOL, amount.0);
            true
        } else {
            self.add_balance(NEAR_SYMBOL, amount.0);
            false
        }
    }

    #[private]
    pub fn on_meta_exit(&mut self, shares: U128) -> bool {
        self.operation_in_flight = false;
        let Some(result) = Self::promise_json::<MetaLiquidUnstakeResult>() else {
            return false;
        };
        let mut position = self
            .positions
            .get(&META_STRATEGY.to_string())
            .unwrap_or_else(|| env::panic_str("Meta Pool position disappeared"));
        let principal_reduction = if shares.0 == position.receipt_units.0 {
            position.principal.0
        } else {
            position.principal.0
                .checked_mul(shares.0)
                .expect("Position ratio overflow")
                / position.receipt_units.0
        };
        position.receipt_units = U128(position.receipt_units.0 - shares.0);
        position.principal = U128(position.principal.0 - principal_reduction);
        position.total_withdrawn = U128(position.total_withdrawn.0.checked_add(result.near.0).expect("Withdrawal overflow"));
        if result.near.0 >= principal_reduction {
            position.realized_yield = U128(position.realized_yield.0 + (result.near.0 - principal_reduction));
        } else {
            position.realized_loss = U128(position.realized_loss.0 + (principal_reduction - result.near.0));
        }
        position.status = if position.receipt_units.0 == 0 { PositionStatus::Closed } else { PositionStatus::Active };
        position.updated_at_ms = env::block_timestamp_ms();
        self.save_position(position);
        self.add_balance(NEAR_SYMBOL, result.near.0);
        Self::log_event("strategy_exited", NEAR_SYMBOL, result.near.0);
        true
    }

    #[private]
    pub fn on_burrow_deposit(&mut self, symbol: String, amount: U128) -> bool {
        self.operation_in_flight = false;
        let unused = Self::promise_json::<U128>();
        if let Some(unused) = unused {
            let deployed = amount.0.saturating_sub(unused.0);
            if unused.0 > 0 {
                self.add_balance(&symbol, unused.0);
            }
            if deployed > 0 {
                let strategy_id = Self::burrow_strategy_id(&symbol);
                let mut position = self.position_or_default(&strategy_id, &symbol, self.burrow_id.clone());
                position.principal = U128(position.principal.0.checked_add(deployed).expect("Principal overflow"));
                position.receipt_units = U128(position.receipt_units.0.checked_add(deployed).expect("Receipt overflow"));
                position.total_deposited = U128(position.total_deposited.0.checked_add(deployed).expect("Deposit overflow"));
                position.status = PositionStatus::Active;
                position.updated_at_ms = env::block_timestamp_ms();
                self.save_position(position);
                Self::log_event("strategy_deployed", &symbol, deployed);
            }
            deployed > 0
        } else {
            self.add_balance(&symbol, amount.0);
            false
        }
    }

    #[private]
    pub fn on_burrow_exit(&mut self, symbol: String, amount: U128) -> PromiseOrValue<bool> {
        if !Self::promise_succeeded() || Self::promise_json::<bool>() == Some(false) {
            self.operation_in_flight = false;
            return PromiseOrValue::Value(false);
        }
        let token = self.token_by_symbol(&symbol);
        PromiseOrValue::Promise(
            ext_ft::ext(token.token_id)
                .with_static_gas(FT_GAS)
                .ft_balance_of(env::current_account_id())
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_burrow_balance(token.symbol, amount),
                ),
        )
    }

    #[private]
    pub fn on_burrow_balance(&mut self, symbol: String, amount: U128) -> bool {
        self.operation_in_flight = false;
        let Some(actual_balance) = Self::promise_json::<U128>() else {
            return false;
        };
        let previous_liquid = self.balance_of(&symbol);
        assert!(actual_balance.0 >= previous_liquid, "Token balance reconciliation decreased unexpectedly");
        let received = actual_balance.0 - previous_liquid;
        let strategy_id = Self::burrow_strategy_id(&symbol);
        let mut position = self
            .positions
            .get(&strategy_id)
            .unwrap_or_else(|| env::panic_str("Lending position disappeared"));
        let principal_reduction = amount.0.min(position.principal.0);
        position.principal = U128(position.principal.0 - principal_reduction);
        position.receipt_units = U128(position.receipt_units.0.saturating_sub(principal_reduction));
        position.total_withdrawn = U128(position.total_withdrawn.0.checked_add(received).expect("Withdrawal overflow"));
        if received >= principal_reduction {
            position.realized_yield = U128(position.realized_yield.0 + (received - principal_reduction));
        } else {
            position.realized_loss = U128(position.realized_loss.0 + (principal_reduction - received));
        }
        position.status = if position.principal.0 == 0 { PositionStatus::Closed } else { PositionStatus::Active };
        position.updated_at_ms = env::block_timestamp_ms();
        self.save_position(position);
        self.balances.insert(&symbol, &actual_balance.0);
        Self::log_event("strategy_exited", &symbol, received);
        true
    }

    pub fn get_treasury(&self) -> TreasurySnapshot {
        let mut assets = vec![self.asset_snapshot(NEAR_SYMBOL, 24, None)];
        assets.extend(self.supported_tokens.iter().map(|token| {
            self.asset_snapshot(&token.symbol, token.decimals, Some(token.token_id.clone()))
        }));
        TreasurySnapshot {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            meta_pool_id: self.meta_pool_id.clone(),
            burrow_id: self.burrow_id.clone(),
            operation_in_flight: self.operation_in_flight,
            assets,
            positions: self
                .position_ids
                .iter()
                .filter_map(|id| self.positions.get(id))
                .collect(),
        }
    }

    pub fn get_deployment_capacity(&self, symbol: String) -> U128 {
        U128(self.deployment_capacity(&self.assert_asset(&symbol)))
    }

    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agent = agent;
    }

    pub fn set_protocols(&mut self, meta_pool_id: AccountId, burrow_id: AccountId) {
        self.assert_owner();
        self.assert_idle();
        self.meta_pool_id = meta_pool_id;
        self.burrow_id = burrow_id;
    }
}

impl VeyraTreasury {
    fn asset_snapshot(&self, symbol: &str, decimals: u8, token_id: Option<AccountId>) -> AssetSnapshot {
        let liquid = self.balance_of(symbol);
        let invested = self.invested_in(symbol);
        let total = liquid.checked_add(invested).expect("Asset total overflow");
        let policy = self.policy_of(symbol);
        let reserve_target = Self::reserve_target(&policy);
        AssetSnapshot {
            symbol: symbol.to_string(),
            decimals,
            token_id,
            liquid: U128(liquid),
            invested: U128(invested),
            total: U128(total),
            reserve_target: U128(reserve_target),
            deployable: U128(self.deployment_capacity(symbol)),
            policy,
        }
    }

    fn deployment_capacity(&self, symbol: &str) -> u128 {
        let liquid = self.balance_of(symbol);
        let invested = self.invested_in(symbol);
        let total = liquid.saturating_add(invested);
        let policy = self.policy_of(symbol);
        let reserve = Self::reserve_target(&policy);
        let surplus = total.saturating_sub(reserve);
        let holdback = surplus
            .checked_mul(policy.liquidity_holdback_bps as u128)
            .expect("Holdback overflow")
            / BPS_DENOMINATOR;
        let max_invested = surplus.saturating_sub(holdback);
        liquid.min(max_invested.saturating_sub(invested))
    }

    fn reserve_target(policy: &AssetPolicy) -> u128 {
        policy
            .obligations
            .0
            .checked_mul(BPS_DENOMINATOR + policy.safety_buffer_bps as u128)
            .expect("Reserve target overflow")
            / BPS_DENOMINATOR
    }

    fn invested_in(&self, symbol: &str) -> u128 {
        self.position_ids
            .iter()
            .filter_map(|id| self.positions.get(id))
            .filter(|position| position.asset == symbol && position.status == PositionStatus::Active)
            .fold(0u128, |sum, position| sum.checked_add(position.principal.0).expect("Invested total overflow"))
    }

    fn position_or_default(&self, strategy_id: &str, asset: &str, provider_id: AccountId) -> Position {
        self.positions.get(&strategy_id.to_string()).unwrap_or(Position {
            strategy_id: strategy_id.to_string(),
            asset: asset.to_string(),
            provider_id,
            principal: U128(0),
            receipt_units: U128(0),
            total_deposited: U128(0),
            total_withdrawn: U128(0),
            realized_yield: U128(0),
            realized_loss: U128(0),
            status: PositionStatus::Closed,
            updated_at_ms: env::block_timestamp_ms(),
        })
    }

    fn save_position(&mut self, position: Position) {
        if self.positions.get(&position.strategy_id).is_none() {
            self.position_ids.push(position.strategy_id.clone());
        }
        self.positions.insert(&position.strategy_id, &position);
    }

    fn policy_of(&self, symbol: &str) -> AssetPolicy {
        self.policies.get(&symbol.to_string()).unwrap_or_default()
    }

    fn balance_of(&self, symbol: &str) -> u128 {
        self.balances.get(&symbol.to_string()).unwrap_or(0)
    }

    fn add_balance(&mut self, symbol: &str, amount: u128) {
        let next = self.balance_of(symbol).checked_add(amount).expect("Balance overflow");
        self.balances.insert(&symbol.to_string(), &next);
    }

    fn sub_balance(&mut self, symbol: &str, amount: u128) {
        let current = self.balance_of(symbol);
        assert!(amount > 0, "Amount must be positive");
        assert!(current >= amount, "Insufficient liquid treasury balance");
        self.balances.insert(&symbol.to_string(), &(current - amount));
    }

    fn token_by_symbol(&self, symbol: &str) -> TokenConfig {
        let normalized = symbol.to_ascii_uppercase();
        self.supported_tokens
            .iter()
            .find(|token| token.symbol.to_ascii_uppercase() == normalized)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Token is not allowlisted"))
    }

    fn assert_asset(&self, symbol: &str) -> String {
        let normalized = symbol.to_ascii_uppercase();
        if normalized == NEAR_SYMBOL {
            return normalized;
        }
        self.token_by_symbol(&normalized).symbol
    }

    fn burrow_strategy_id(symbol: &str) -> String {
        format!("burrow-{}", symbol.to_ascii_lowercase())
    }

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Only the treasury owner may call this method");
    }

    fn assert_operator(&self) {
        let caller = env::predecessor_account_id();
        assert!(caller == self.owner || caller == self.agent, "Caller is not an authorized treasury operator");
    }

    fn assert_idle(&self) {
        assert!(!self.operation_in_flight, "Another treasury operation is still in flight");
    }

    fn promise_succeeded() -> bool {
        matches!(env::promise_result(0), PromiseResult::Successful(_))
    }

    fn promise_json<T: for<'de> Deserialize<'de>>() -> Option<T> {
        match env::promise_result(0) {
            PromiseResult::Successful(bytes) => near_sdk::serde_json::from_slice(&bytes).ok(),
            _ => None,
        }
    }

    fn log_event(event: &str, asset: &str, amount: u128) {
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"veyra_treasury\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{{\"asset\":\"{}\",\"amount\":\"{}\"}}}}",
            event, asset, amount
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, VMContext};

    const ONE_NEAR: u128 = 10u128.pow(24);

    fn account(value: &str) -> AccountId {
        value.parse().unwrap()
    }

    fn context(predecessor: &str, deposit: u128) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("treasury.testnet"))
            .signer_account_id(account(predecessor))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build()
    }

    fn treasury() -> VeyraTreasury {
        VeyraTreasury::new(
            account("owner.testnet"),
            account("agent.testnet"),
            account("meta-v2.pool.testnet"),
            account("burrow.testnet"),
            vec![TokenConfig {
                token_id: account("usdc.testnet"),
                symbol: "USDC".to_string(),
                decimals: 6,
            }],
        )
    }

    #[test]
    fn reserve_policy_caps_native_deployment() {
        testing_env!(context("owner.testnet", 1_000 * ONE_NEAR));
        let mut contract = treasury();
        contract.deposit_near();
        testing_env!(context("owner.testnet", 0));
        contract.set_asset_policy("NEAR".to_string(), U128(500 * ONE_NEAR), 2_000, 3_000);
        assert_eq!(contract.get_deployment_capacity("NEAR".to_string()).0, 280 * ONE_NEAR);
    }

    #[test]
    fn token_deposit_uses_allowlist() {
        testing_env!(context("owner.testnet", 0));
        let mut contract = treasury();
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("treasury.testnet"))
            .signer_account_id(account("owner.testnet"))
            .predecessor_account_id(account("usdc.testnet"));
        testing_env!(builder.build());
        let unused = contract.ft_on_transfer(account("owner.testnet"), U128(10_000_000), "".to_string());
        assert!(matches!(unused, PromiseOrValue::Value(U128(0))));
        assert_eq!(contract.get_treasury().assets[1].liquid.0, 10_000_000);
    }

    #[test]
    #[should_panic(expected = "Amount exceeds the policy-approved NEAR surplus")]
    fn cannot_deploy_protected_reserve() {
        testing_env!(context("owner.testnet", 10 * ONE_NEAR));
        let mut contract = treasury();
        contract.deposit_near();
        testing_env!(context("owner.testnet", 0));
        contract.set_asset_policy("NEAR".to_string(), U128(10 * ONE_NEAR), 0, 0);
        let _ = contract.deploy_meta_pool(U128(ONE_NEAR));
    }

    #[test]
    fn agent_can_deploy_only_policy_surplus() {
        testing_env!(context("owner.testnet", 10 * ONE_NEAR));
        let mut contract = treasury();
        contract.deposit_near();
        testing_env!(context("owner.testnet", 0));
        contract.set_asset_policy("NEAR".to_string(), U128(5 * ONE_NEAR), 0, 0);
        testing_env!(context("agent.testnet", 0));
        let _ = contract.deploy_meta_pool(U128(ONE_NEAR));
        assert_eq!(contract.get_treasury().assets[0].liquid.0, 9 * ONE_NEAR);
        assert!(contract.get_treasury().operation_in_flight);
    }
}
