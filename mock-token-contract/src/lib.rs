use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockToken {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl MockToken {
    #[init]
    pub fn new(
        owner_id: AccountId,
        total_supply: U128,
        name: String,
        symbol: String,
        decimals: u8,
    ) -> Self {
        require!(!env::state_exists(), "Token is already initialized");
        require!(!name.trim().is_empty(), "Token name is required");
        require!(!symbol.trim().is_empty(), "Token symbol is required");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon: None,
            reference: None,
            reference_hash: None,
            decimals,
        };
        metadata.assert_valid();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("Veyra testnet supply"),
        }
        .emit();
        this
    }
}

#[near]
impl FungibleTokenCore for MockToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .internal_ft_resolve_transfer(&sender_id, receiver_id, amount)
            .0
            .into()
    }
}

#[near]
impl StorageManagement for MockToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
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

    fn context() -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("usdc.testnet"))
            .signer_account_id(account("owner.testnet"))
            .predecessor_account_id(account("owner.testnet"))
            .build()
    }

    #[test]
    fn initializes_six_decimal_supply() {
        testing_env!(context());
        let token = MockToken::new(
            account("owner.testnet"),
            U128(1_000_000_000_000),
            "Veyra Test USDC".to_string(),
            "USDC".to_string(),
            6,
        );
        assert_eq!(token.ft_total_supply().0, 1_000_000_000_000);
        assert_eq!(token.ft_metadata().decimals, 6);
    }
}
