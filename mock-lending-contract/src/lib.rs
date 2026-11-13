use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue, PromiseResult,
};

const FT_TRANSFER_GAS: Gas = Gas::from_tgas(35);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);
const BPS_DENOMINATOR: u128 = 10_000;

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    Balances,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenConfig {
    pub token_id: AccountId,
    pub symbol: String,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub enum LendingAction {
    Withdraw {
        token_id: AccountId,
        max_amount: U128,
    },
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SupplyPosition {
    pub token_id: AccountId,
    pub balance: U128,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait LendingCallbacks {
    fn on_withdraw_complete(
        &mut self,
        account_id: AccountId,
        token_id: AccountId,
        principal: U128,
    ) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockLending {
    admin: AccountId,
    tokens: Vec<TokenConfig>,
    balances: LookupMap<String, u128>,
    reward_bps: u16,
}

#[near]
impl MockLending {
    #[init]
    pub fn new(admin: AccountId, tokens: Vec<TokenConfig>, reward_bps: u16) -> Self {
        assert!(!env::state_exists(), "Lending adapter is already initialized");
        assert!(reward_bps <= 1_000, "Test reward cannot exceed 10%");
        Self {
            admin,
            tokens,
            balances: LookupMap::new(StorageKey::Balances),
            reward_bps,
        }
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        _msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        self.assert_token(&token_id);
        assert!(amount.0 > 0, "Supply amount must be positive");
        let key = Self::key(&sender_id, &token_id);
        let next = self
            .balances
            .get(&key)
            .unwrap_or(0)
            .checked_add(amount.0)
            .expect("Supply balance overflow");
        self.balances.insert(&key, &next);
        env::log_str(&format!("{} supplied {} of {}", sender_id, amount.0, token_id));
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn execute(&mut self, actions: Vec<LendingAction>) -> Promise {
        assert_eq!(env::attached_deposit(), NearToken::from_yoctonear(1), "Attach exactly 1 yoctoNEAR");
        assert_eq!(actions.len(), 1, "The test adapter accepts one action at a time");
        match actions.into_iter().next().unwrap() {
            LendingAction::Withdraw { token_id, max_amount } => {
                self.withdraw(token_id, max_amount)
            }
        }
    }

    pub fn get_account(&self, account_id: AccountId) -> Vec<SupplyPosition> {
        self.tokens
            .iter()
            .filter_map(|token| {
                let balance = self.balances.get(&Self::key(&account_id, &token.token_id)).unwrap_or(0);
                (balance > 0).then_some(SupplyPosition {
                    token_id: token.token_id.clone(),
                    balance: U128(balance),
                })
            })
            .collect()
    }

    pub fn set_reward_bps(&mut self, reward_bps: u16) {
        assert_eq!(env::predecessor_account_id(), self.admin, "Only the admin may update rewards");
        assert!(reward_bps <= 1_000, "Test reward cannot exceed 10%");
        self.reward_bps = reward_bps;
    }

    #[private]
    pub fn on_withdraw_complete(
        &mut self,
        account_id: AccountId,
        token_id: AccountId,
        principal: U128,
    ) -> bool {
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            return true;
        }
        let key = Self::key(&account_id, &token_id);
        let restored = self
            .balances
            .get(&key)
            .unwrap_or(0)
            .checked_add(principal.0)
            .expect("Restored balance overflow");
        self.balances.insert(&key, &restored);
        false
    }
}

impl MockLending {
    fn withdraw(&mut self, token_id: AccountId, amount: U128) -> Promise {
        self.assert_token(&token_id);
        let account_id = env::predecessor_account_id();
        let key = Self::key(&account_id, &token_id);
        let current = self.balances.get(&key).unwrap_or(0);
        assert!(amount.0 > 0 && amount.0 <= current, "Withdrawal exceeds supplied principal");
        self.balances.insert(&key, &(current - amount.0));
        let reward = amount
            .0
            .checked_mul(self.reward_bps as u128)
            .expect("Reward overflow")
            / BPS_DENOMINATOR;
        let payout = amount.0.checked_add(reward).expect("Payout overflow");
        ext_ft::ext(token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(FT_TRANSFER_GAS)
            .ft_transfer(
                account_id.clone(),
                U128(payout),
                Some("Veyra test lending withdrawal".to_string()),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdraw_complete(account_id, token_id, amount),
            )
    }

    fn assert_token(&self, token_id: &AccountId) {
        assert!(self.tokens.iter().any(|token| &token.token_id == token_id), "Token is not supported");
    }

    fn key(account_id: &AccountId, token_id: &AccountId) -> String {
        format!("{}|{}", account_id, token_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, VMContext};

    fn account(value: &str) -> AccountId {
        value.parse().unwrap()
    }

    fn context(predecessor: &str, deposit: u128) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("lending.testnet"))
            .signer_account_id(account(predecessor))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build()
    }

    #[test]
    fn records_token_supply_for_sender() {
        testing_env!(context("admin.testnet", 0));
        let mut lending = MockLending::new(
            account("admin.testnet"),
            vec![TokenConfig {
                token_id: account("usdc.testnet"),
                symbol: "USDC".to_string(),
            }],
            10,
        );
        testing_env!(context("usdc.testnet", 0));
        let unused = lending.ft_on_transfer(account("treasury.testnet"), U128(1_000_000), "".to_string());
        assert!(matches!(unused, PromiseOrValue::Value(U128(0))));
        assert_eq!(lending.get_account(account("treasury.testnet"))[0].balance.0, 1_000_000);
    }
}
