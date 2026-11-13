use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(12);
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(20);
const MAX_BATCH_SIZE: usize = 200;

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    Batches,
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq,
)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum PaymentStatus {
    Pending,
    Processing,
    Success,
    Failed,
    Cancelled,
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq,
)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum BatchStatus {
    Ready,
    Processing,
    Complete,
    Cancelled,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentItem {
    pub recipient: AccountId,
    pub amount: U128,
    pub status: PaymentStatus,
    pub error: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenConfig {
    pub token_id: AccountId,
    pub symbol: String,
    pub decimals: u8,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct FtBatchMessage {
    pub recipients: Vec<AccountId>,
    pub amounts: Vec<U128>,
    pub memo: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Batch {
    pub id: U64,
    pub owner: AccountId,
    pub token_id: Option<AccountId>,
    pub token_symbol: String,
    pub token_decimals: u8,
    pub memo: String,
    pub items: Vec<PaymentItem>,
    pub total_amount: U128,
    pub escrow_remaining: U128,
    pub paid_amount: U128,
    pub status: BatchStatus,
    pub created_at: U64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ContractConfig {
    admin: AccountId,
    agent: AccountId,
    next_batch_id: U64,
    max_batch_size: u32,
    supported_tokens: Vec<TokenConfig>,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ContractCallbacks {
    fn on_transfer_complete(&mut self, batch_id: u64, index: u32) -> bool;
    fn on_refund_complete(&mut self, batch_id: u64, amount: U128) -> bool;
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VeyraContract {
    admin: AccountId,
    agent: AccountId,
    next_batch_id: u64,
    batches: LookupMap<u64, Batch>,
    supported_tokens: Vec<TokenConfig>,
}

#[near]
impl VeyraContract {
    #[init]
    pub fn new(agent: AccountId, supported_tokens: Option<Vec<TokenConfig>>) -> Self {
        assert!(!env::state_exists(), "Contract is already initialized");
        Self {
            admin: env::predecessor_account_id(),
            agent,
            next_batch_id: 0,
            batches: LookupMap::new(StorageKey::Batches),
            supported_tokens: supported_tokens.unwrap_or_default(),
        }
    }

    #[payable]
    pub fn create_batch(
        &mut self,
        recipients: Vec<AccountId>,
        amounts: Vec<U128>,
        memo: Option<String>,
    ) -> U64 {
        assert_eq!(recipients.len(), amounts.len(), "Recipients and amounts must match");
        assert!(!recipients.is_empty(), "A batch needs at least one payment");
        assert!(recipients.len() <= MAX_BATCH_SIZE, "Batch exceeds the 200 item limit");

        let total = Self::validate_batch_input(&recipients, &amounts);
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            total,
            "Attach exactly the total payment amount"
        );

        self.internal_create_batch(
            env::predecessor_account_id(),
            recipients,
            amounts,
            memo,
            None,
            "NEAR".to_string(),
            24,
            total,
        )
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        let token = self
            .supported_tokens
            .iter()
            .find(|token| token.token_id == token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Token is not allowlisted"));
        let request: FtBatchMessage = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("Invalid Veyra batch message"));
        let total = Self::validate_batch_input(&request.recipients, &request.amounts);
        assert_eq!(total, amount.0, "Transferred token amount must equal the batch total");

        self.internal_create_batch(
            sender_id,
            request.recipients,
            request.amounts,
            request.memo,
            Some(token.token_id),
            token.symbol,
            token.decimals,
            total,
        );
        PromiseOrValue::Value(U128(0))
    }

    fn internal_create_batch(
        &mut self,
        owner: AccountId,
        recipients: Vec<AccountId>,
        amounts: Vec<U128>,
        memo: Option<String>,
        token_id: Option<AccountId>,
        token_symbol: String,
        token_decimals: u8,
        total: u128,
    ) -> U64 {
        let batch_id = self.next_batch_id;
        self.next_batch_id = self.next_batch_id.checked_add(1).expect("Batch id overflow");
        let items = recipients
            .into_iter()
            .zip(amounts)
            .map(|(recipient, amount)| PaymentItem {
                recipient,
                amount,
                status: PaymentStatus::Pending,
                error: None,
            })
            .collect();
        let batch = Batch {
            id: U64(batch_id),
            owner,
            token_id,
            token_symbol,
            token_decimals,
            memo: memo.unwrap_or_else(|| "Veyra payment batch".to_string()),
            items,
            total_amount: U128(total),
            escrow_remaining: U128(total),
            paid_amount: U128(0),
            status: BatchStatus::Ready,
            created_at: U64(env::block_timestamp_ms()),
        };
        self.batches.insert(&batch_id, &batch);
        Self::log_event("batch_created", batch_id, None);
        U64(batch_id)
    }

    pub fn start_processing(&mut self, batch_id: u64) {
        let mut batch = self.get_batch_or_panic(batch_id);
        self.assert_operator(&batch);
        assert_eq!(batch.status, BatchStatus::Ready, "Batch is not ready");
        batch.status = BatchStatus::Processing;
        self.batches.insert(&batch_id, &batch);
        Self::log_event("batch_started", batch_id, None);
    }

    pub fn process_item(&mut self, batch_id: u64, index: u32) -> Promise {
        let mut batch = self.get_batch_or_panic(batch_id);
        self.assert_operator(&batch);
        assert!(
            matches!(batch.status, BatchStatus::Ready | BatchStatus::Processing),
            "Batch cannot be processed"
        );

        let item = batch
            .items
            .get_mut(index as usize)
            .unwrap_or_else(|| env::panic_str("Payment index is out of range"));
        assert_eq!(item.status, PaymentStatus::Pending, "Payment is not pending");
        item.status = PaymentStatus::Processing;
        item.error = None;
        let recipient = item.recipient.clone();
        let amount = item.amount.0;
        batch.status = BatchStatus::Processing;
        self.batches.insert(&batch_id, &batch);
        Self::log_event("payment_started", batch_id, Some(index));

        let transfer = match batch.token_id.clone() {
            Some(token_id) => ext_ft::ext(token_id)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(FT_TRANSFER_GAS)
                .ft_transfer(recipient, U128(amount), Some(format!("Veyra batch {}", batch_id))),
            None => Promise::new(recipient).transfer(NearToken::from_yoctonear(amount)),
        };
        transfer.then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_transfer_complete(batch_id, index),
        )
    }

    #[private]
    pub fn on_transfer_complete(&mut self, batch_id: u64, index: u32) -> bool {
        let mut batch = self.get_batch_or_panic(batch_id);
        let item = batch
            .items
            .get_mut(index as usize)
            .unwrap_or_else(|| env::panic_str("Payment index is out of range"));
        assert_eq!(item.status, PaymentStatus::Processing, "Payment was not processing");

        let succeeded = env::promise_result_checked(0, 0).is_ok();
        if succeeded {
            item.status = PaymentStatus::Success;
            item.error = None;
            batch.escrow_remaining = U128(
                batch
                    .escrow_remaining
                    .0
                    .checked_sub(item.amount.0)
                    .expect("Escrow accounting underflow"),
            );
            batch.paid_amount = U128(
                batch
                    .paid_amount
                    .0
                    .checked_add(item.amount.0)
                    .expect("Paid amount overflow"),
            );
            Self::log_event("payment_succeeded", batch_id, Some(index));
        } else {
            item.status = PaymentStatus::Failed;
            item.error = Some("Asset transfer receipt failed".to_string());
            Self::log_event("payment_failed", batch_id, Some(index));
        }

        if batch.items.iter().all(|payment| {
            matches!(
                payment.status,
                PaymentStatus::Success | PaymentStatus::Failed | PaymentStatus::Cancelled
            )
        }) {
            batch.status = BatchStatus::Complete;
            let refund = batch.escrow_remaining.0;
            if refund > 0 {
                batch.escrow_remaining = U128(0);
                self.dispatch_refund(
                    batch_id,
                    batch.owner.clone(),
                    batch.token_id.clone(),
                    refund,
                )
                .detach();
            }
            Self::log_event("batch_completed", batch_id, None);
        }

        self.batches.insert(&batch_id, &batch);
        succeeded
    }

    pub fn cancel_batch(&mut self, batch_id: u64) -> Promise {
        let mut batch = self.get_batch_or_panic(batch_id);
        assert_eq!(env::predecessor_account_id(), batch.owner, "Only the owner can cancel");
        assert!(
            matches!(batch.status, BatchStatus::Ready | BatchStatus::Processing),
            "Batch cannot be cancelled"
        );
        assert!(
            !batch
                .items
                .iter()
                .any(|item| item.status == PaymentStatus::Processing),
            "Wait for in-flight transfers before cancelling"
        );

        for item in &mut batch.items {
            if matches!(item.status, PaymentStatus::Pending | PaymentStatus::Failed) {
                item.status = PaymentStatus::Cancelled;
                item.error = Some("Cancelled by batch owner".to_string());
            }
        }
        let refund = batch.escrow_remaining.0;
        batch.escrow_remaining = U128(0);
        batch.status = BatchStatus::Cancelled;
        let owner = batch.owner.clone();
        self.batches.insert(&batch_id, &batch);
        Self::log_event("batch_cancelled", batch_id, None);
        self.dispatch_refund(batch_id, owner, batch.token_id.clone(), refund)
    }

    #[private]
    pub fn on_refund_complete(&mut self, batch_id: u64, amount: U128) -> bool {
        let succeeded = env::promise_result_checked(0, 0).is_ok();
        if !succeeded {
            let mut batch = self.get_batch_or_panic(batch_id);
            batch.escrow_remaining = U128(
                batch.escrow_remaining.0.checked_add(amount.0).expect("Refund accounting overflow"),
            );
            self.batches.insert(&batch_id, &batch);
            Self::log_event("refund_failed", batch_id, None);
        }
        succeeded
    }

    pub fn set_agent(&mut self, agent: AccountId) {
        assert_eq!(env::predecessor_account_id(), self.admin, "Only the admin can update the agent");
        self.agent = agent;
    }

    pub fn set_supported_token(&mut self, token: TokenConfig) {
        assert_eq!(env::predecessor_account_id(), self.admin, "Only the admin can update tokens");
        assert!(!token.symbol.trim().is_empty(), "Token symbol is required");
        assert!(token.decimals > 0, "Token decimals must be positive");
        self.supported_tokens.retain(|item| item.token_id != token.token_id);
        self.supported_tokens.push(token);
    }

    pub fn get_batch(&self, batch_id: u64) -> Option<Batch> {
        self.batches.get(&batch_id)
    }

    pub fn get_batches_by_owner(
        &self,
        owner: AccountId,
        from_index: Option<u64>,
        limit: Option<u32>,
    ) -> Vec<Batch> {
        let start = from_index.unwrap_or(0);
        let take = limit.unwrap_or(20).min(50) as usize;
        (start..self.next_batch_id)
            .filter_map(|batch_id| self.batches.get(&batch_id))
            .filter(|batch| batch.owner == owner)
            .take(take)
            .collect()
    }

    pub fn get_config(&self) -> ContractConfig {
        ContractConfig {
            admin: self.admin.clone(),
            agent: self.agent.clone(),
            next_batch_id: U64(self.next_batch_id),
            max_batch_size: MAX_BATCH_SIZE as u32,
            supported_tokens: self.supported_tokens.clone(),
        }
    }

    fn validate_batch_input(recipients: &[AccountId], amounts: &[U128]) -> u128 {
        assert_eq!(recipients.len(), amounts.len(), "Recipients and amounts must match");
        assert!(!recipients.is_empty(), "A batch needs at least one payment");
        assert!(recipients.len() <= MAX_BATCH_SIZE, "Batch exceeds the 200 item limit");
        amounts.iter().fold(0u128, |sum, amount| {
            assert!(amount.0 > 0, "Every payment amount must be greater than zero");
            sum.checked_add(amount.0).expect("Total amount overflow")
        })
    }

    fn dispatch_refund(
        &self,
        batch_id: u64,
        owner: AccountId,
        token_id: Option<AccountId>,
        amount: u128,
    ) -> Promise {
        let refund = match token_id {
            Some(token_id) => ext_ft::ext(token_id)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(FT_TRANSFER_GAS)
                .ft_transfer(owner, U128(amount), Some(format!("Veyra refund for batch {}", batch_id))),
            None => Promise::new(owner).transfer(NearToken::from_yoctonear(amount)),
        };
        refund.then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_refund_complete(batch_id, U128(amount)),
        )
    }

    fn get_batch_or_panic(&self, batch_id: u64) -> Batch {
        self.batches
            .get(&batch_id)
            .unwrap_or_else(|| env::panic_str("Batch does not exist"))
    }

    fn assert_operator(&self, batch: &Batch) {
        let caller = env::predecessor_account_id();
        assert!(caller == batch.owner || caller == self.agent, "Caller is not an authorized operator");
    }

    fn log_event(event: &str, batch_id: u64, index: Option<u32>) {
        let data = match index {
            Some(value) => format!(
                "{{\"standard\":\"veyra\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{{\"batch_id\":{},\"index\":{}}}}}",
                event, batch_id, value
            ),
            None => format!(
                "{{\"standard\":\"veyra\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{{\"batch_id\":{}}}}}",
                event, batch_id
            ),
        };
        env::log_str(&format!("EVENT_JSON:{}", data));
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
            .current_account_id(account("veyra.testnet"))
            .signer_account_id(account(predecessor))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build()
    }

    #[test]
    fn creates_a_funded_batch() {
        testing_env!(context("owner.testnet", 3 * ONE_NEAR));
        let mut contract = VeyraContract::new(account("agent.testnet"), None);
        let id = contract.create_batch(
            vec![account("alice.testnet"), account("bob.testnet")],
            vec![U128(ONE_NEAR), U128(2 * ONE_NEAR)],
            Some("November payroll".to_string()),
        );

        let batch = contract.get_batch(id.0).unwrap();
        assert_eq!(batch.owner, account("owner.testnet"));
        assert_eq!(batch.items.len(), 2);
        assert_eq!(batch.total_amount.0, 3 * ONE_NEAR);
        assert_eq!(batch.status, BatchStatus::Ready);
    }

    #[test]
    #[should_panic(expected = "Attach exactly the total payment amount")]
    fn rejects_underfunded_batch() {
        testing_env!(context("owner.testnet", ONE_NEAR));
        let mut contract = VeyraContract::new(account("agent.testnet"), None);
        contract.create_batch(
            vec![account("alice.testnet")],
            vec![U128(2 * ONE_NEAR)],
            None,
        );
    }

    #[test]
    fn owner_can_cancel_and_refund_pending_batch() {
        testing_env!(context("owner.testnet", ONE_NEAR));
        let mut contract = VeyraContract::new(account("agent.testnet"), None);
        let id = contract.create_batch(
            vec![account("alice.testnet")],
            vec![U128(ONE_NEAR)],
            None,
        );

        testing_env!(context("owner.testnet", 0));
        let _ = contract.cancel_batch(id.0);
        let batch = contract.get_batch(id.0).unwrap();
        assert_eq!(batch.status, BatchStatus::Cancelled);
        assert_eq!(batch.escrow_remaining.0, 0);
        assert_eq!(batch.items[0].status, PaymentStatus::Cancelled);
    }

    #[test]
    fn configured_agent_can_start_processing() {
        testing_env!(context("owner.testnet", ONE_NEAR));
        let mut contract = VeyraContract::new(account("agent.testnet"), None);
        let id = contract.create_batch(
            vec![account("alice.testnet")],
            vec![U128(ONE_NEAR)],
            None,
        );

        testing_env!(context("agent.testnet", 0));
        contract.start_processing(id.0);
        assert_eq!(contract.get_batch(id.0).unwrap().status, BatchStatus::Processing);
    }

    #[test]
    fn creates_an_allowlisted_fungible_token_batch() {
        testing_env!(context("admin.testnet", 0));
        let usdc = TokenConfig {
            token_id: account("usdc.testnet"),
            symbol: "USDC".to_string(),
            decimals: 6,
        };
        let mut contract = VeyraContract::new(account("agent.testnet"), Some(vec![usdc]));

        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("veyra.testnet"))
            .signer_account_id(account("owner.testnet"))
            .predecessor_account_id(account("usdc.testnet"));
        testing_env!(builder.build());
        let message = near_sdk::serde_json::json!({
            "recipients": ["alice.testnet", "bob.testnet"],
            "amounts": ["1250000", "750000"],
            "memo": "Stablecoin payroll"
        })
        .to_string();
        let unused = contract.ft_on_transfer(account("owner.testnet"), U128(2_000_000), message);

        assert!(matches!(unused, PromiseOrValue::Value(U128(0))));
        let batch = contract.get_batch(0).unwrap();
        assert_eq!(batch.owner, account("owner.testnet"));
        assert_eq!(batch.token_id, Some(account("usdc.testnet")));
        assert_eq!(batch.token_symbol, "USDC");
        assert_eq!(batch.token_decimals, 6);
        assert_eq!(batch.total_amount.0, 2_000_000);
    }

    #[test]
    #[should_panic(expected = "Token is not allowlisted")]
    fn rejects_unlisted_fungible_tokens() {
        testing_env!(context("admin.testnet", 0));
        let mut contract = VeyraContract::new(account("agent.testnet"), None);
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("veyra.testnet"))
            .signer_account_id(account("owner.testnet"))
            .predecessor_account_id(account("malicious-token.testnet"));
        testing_env!(builder.build());
        let message = near_sdk::serde_json::json!({
            "recipients": ["alice.testnet"],
            "amounts": ["1000000"]
        })
        .to_string();
        let _ = contract.ft_on_transfer(account("owner.testnet"), U128(1_000_000), message);
    }
}
