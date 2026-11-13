"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { BrowserWallet, InjectedWallet, Wallet, WalletSelector } from "@near-wallet-selector/core";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { actionCreators } from "@near-js/transactions";

type SupportedWalletId = "meteor-wallet" | "my-near-wallet";

interface CallMethodInput {
  receiverId?: string;
  methodName: string;
  args: object;
  deposit?: string;
  gas?: string;
}

interface WalletContextValue {
  accountId: string | null;
  ready: boolean;
  connecting: boolean;
  contractId: string;
  treasuryContractId: string;
  isContractMode: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  callMethod: (input: CallMethodInput) => Promise<string | undefined>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const TREASURY_CONTRACT_ID = process.env.NEXT_PUBLIC_TREASURY_CONTRACT_ID ?? "";

function transactionHash(outcome: unknown): string | undefined {
  if (!outcome || typeof outcome !== "object") return undefined;
  const transaction = (outcome as { transaction?: { hash?: string } }).transaction;
  return transaction?.hash;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;

    setupWalletSelector({
      network: (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet",
      modules: [setupMeteorWallet(), setupMyNearWallet()],
    }).then((nextSelector) => {
      if (!active) return;
      setSelector(nextSelector);
      setAccountId(nextSelector.store.getState().accounts[0]?.accountId ?? null);
      subscription = nextSelector.store.observable.subscribe((state) => {
        setAccountId(state.accounts[0]?.accountId ?? null);
        setConnecting(false);
      });
    });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const connect = useCallback(() => {
    setConnectionError(null);
    setChooserOpen(true);
  }, []);

  const connectWallet = useCallback(
    async (walletId: SupportedWalletId) => {
      if (!selector) return;
      setConnecting(true);
      setConnectionError(null);
      try {
        const signInParams = { contractId: CONTRACT_ID || TREASURY_CONTRACT_ID || undefined };
        const accounts = walletId === "meteor-wallet"
          ? await (await selector.wallet<InjectedWallet>(walletId)).signIn(signInParams)
          : await (await selector.wallet<BrowserWallet>(walletId)).signIn(signInParams);
        setAccountId(accounts[0]?.accountId ?? null);
        setChooserOpen(false);
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : "The wallet connection was not completed.");
      } finally {
        setConnecting(false);
      }
    },
    [selector],
  );

  const disconnect = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAccountId(null);
  }, [selector]);

  const getWallet = useCallback(async (): Promise<Wallet> => {
    if (!selector) throw new Error("Wallet selector is still loading.");
    return selector.wallet();
  }, [selector]);

  const callMethod = useCallback(
    async ({ receiverId = CONTRACT_ID, methodName, args, deposit = "0", gas = "100000000000000" }: CallMethodInput) => {
      if (!receiverId) throw new Error("A transaction receiver is required.");
      if (!accountId) throw new Error("Connect a NEAR wallet first.");
      const wallet = await getWallet();
      const outcome = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId,
        actions: [actionCreators.functionCall(methodName, args, BigInt(gas), BigInt(deposit))],
      });
      return transactionHash(outcome);
    },
    [accountId, getWallet],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      accountId,
      ready: Boolean(selector),
      connecting,
      contractId: CONTRACT_ID,
      treasuryContractId: TREASURY_CONTRACT_ID,
      isContractMode: Boolean(CONTRACT_ID || TREASURY_CONTRACT_ID),
      connect,
      disconnect,
      callMethod,
    }),
    [accountId, selector, connecting, connect, disconnect, callMethod],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {chooserOpen ? (
        <div className="wallet-chooser-backdrop" role="presentation" onMouseDown={() => !connecting && setChooserOpen(false)}>
          <section
            className="wallet-chooser"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-chooser-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="wallet-chooser-heading">
              <div>
                <p className="eyebrow">Existing accounts only</p>
                <h2 id="wallet-chooser-title">Connect your wallet</h2>
              </div>
              <button className="wallet-chooser-close" type="button" aria-label="Close wallet chooser" disabled={connecting} onClick={() => setChooserOpen(false)}>×</button>
            </div>
            <p className="wallet-chooser-copy">Veyra only requests access to an account you already own. It never creates a wallet or stores your keys.</p>
            <div className="wallet-chooser-options">
              <button type="button" className="wallet-option" disabled={connecting} onClick={() => void connectWallet("meteor-wallet")}>
                <span className="wallet-option-mark meteor-mark">M</span>
                <span><strong>Meteor Wallet</strong><small>Connect an existing Meteor account</small></span>
                <span className="wallet-option-arrow" aria-hidden="true">→</span>
              </button>
              <button type="button" className="wallet-option" disabled={connecting} onClick={() => void connectWallet("my-near-wallet")}>
                <span className="wallet-option-mark near-mark">N</span>
                <span><strong>MyNearWallet</strong><small>Connect an existing NEAR account</small></span>
                <span className="wallet-option-arrow" aria-hidden="true">→</span>
              </button>
            </div>
            {connectionError ? <p className="wallet-chooser-error" role="alert">{connectionError}</p> : null}
            <p className="wallet-chooser-footnote">You will approve access inside the wallet you select.</p>
          </section>
        </div>
      ) : null}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
