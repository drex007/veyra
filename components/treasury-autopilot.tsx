"use client";

import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  WalletCards,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/components/wallet-provider";
import { calculateTreasuryPlan, strategyRegistry, type YieldStrategy } from "@/lib/defi";
import { parseTokenAmount } from "@/lib/amounts";
import {
  bpsFromPercent,
  formatAtomic,
  type ChainTreasuryAsset,
  type ChainTreasuryPosition,
  type ChainTreasurySnapshot,
} from "@/lib/treasury";
import type { PaymentToken } from "@/lib/types";

interface StrategySnapshotResponse {
  strategies: YieldStrategy[];
  marketStatus: "live" | "degraded";
  asOf: string;
}

interface TreasuryApiResponse {
  configured: boolean;
  contractId?: string;
  treasury: ChainTreasurySnapshot | null;
  error?: string;
}

const tokenContractIds: Partial<Record<PaymentToken, string>> = {
  USDC: process.env.NEXT_PUBLIC_USDC_TOKEN_ID,
  USDT: process.env.NEXT_PUBLIC_USDT_TOKEN_ID,
};

const assets: PaymentToken[] = ["NEAR", "USDC", "USDT"];

export function TreasuryAutopilot() {
  const wallet = useWallet();
  const [selectedAsset, setSelectedAsset] = useState<PaymentToken>("NEAR");
  const [demoBalance, setDemoBalance] = useState(1_000);
  const [obligations, setObligations] = useState(500);
  const [safetyBufferPercent, setSafetyBufferPercent] = useState(20);
  const [liquidityHoldbackPercent, setLiquidityHoldbackPercent] = useState(30);
  const [actionAmount, setActionAmount] = useState("10");
  const [strategies, setStrategies] = useState<YieldStrategy[]>(strategyRegistry);
  const [marketStatus, setMarketStatus] = useState<"loading" | "live" | "degraded">("loading");
  const [marketAsOf, setMarketAsOf] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<ChainTreasurySnapshot | null>(null);
  const [treasuryConfigured, setTreasuryConfigured] = useState(false);
  const [loadingTreasury, setLoadingTreasury] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refreshTreasury = useCallback(async () => {
    setLoadingTreasury(true);
    try {
      const response = await fetch("/api/defi/treasury", { cache: "no-store" });
      const payload = await response.json() as TreasuryApiResponse;
      setTreasuryConfigured(payload.configured);
      setTreasury(payload.treasury);
      if (!response.ok && payload.error) setError(payload.error);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read the treasury contract.");
    } finally {
      setLoadingTreasury(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/defi/strategies", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Market feed unavailable");
        return response.json() as Promise<StrategySnapshotResponse>;
      })
      .then((snapshot) => {
        setStrategies(snapshot.strategies);
        setMarketStatus(snapshot.marketStatus);
        setMarketAsOf(snapshot.asOf);
      })
      .catch((nextError: unknown) => {
        if (nextError instanceof DOMException && nextError.name === "AbortError") return;
        setMarketStatus("degraded");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    void refreshTreasury();
  }, [refreshTreasury, wallet.accountId]);

  const chainAsset = useMemo(
    () => treasury?.assets.find((asset) => asset.symbol === selectedAsset) ?? null,
    [selectedAsset, treasury],
  );

  useEffect(() => {
    if (!chainAsset) return;
    setObligations(Number(formatAtomic(chainAsset.policy.obligations, chainAsset.decimals, 6)));
    setSafetyBufferPercent(chainAsset.policy.safety_buffer_bps / 100);
    setLiquidityHoldbackPercent(chainAsset.policy.liquidity_holdback_bps / 100);
  }, [chainAsset]);

  const balance = chainAsset
    ? Number(formatAtomic(chainAsset.total, chainAsset.decimals, 6))
    : demoBalance;
  const plan = useMemo(() => calculateTreasuryPlan({
    balanceNear: balance,
    obligationsNear: obligations,
    safetyBufferPercent,
    liquidityHoldbackPercent,
  }), [balance, obligations, safetyBufferPercent, liquidityHoldbackPercent]);
  const deployable = chainAsset
    ? Number(formatAtomic(chainAsset.deployable, chainAsset.decimals, 6))
    : plan.deployableNear;
  const liquid = chainAsset
    ? Number(formatAtomic(chainAsset.liquid, chainAsset.decimals, 6))
    : plan.totalLiquidNear;
  const invested = chainAsset
    ? Number(formatAtomic(chainAsset.invested, chainAsset.decimals, 6))
    : Math.max(0, balance - liquid);
  const protectedTarget = chainAsset
    ? Number(formatAtomic(chainAsset.reserve_target, chainAsset.decimals, 6))
    : plan.reserveTargetNear;
  const liquidPercent = balance > 0 ? Math.min(100, (liquid / balance) * 100) : 100;
  const investedPercent = balance > 0 ? Math.min(100, (invested / balance) * 100) : 0;
  const matchingStrategy = strategies.find((strategy) =>
    selectedAsset === "NEAR"
      ? strategy.id === "meta-pool-stnear"
      : strategy.id === `burrow-${selectedAsset.toLowerCase()}`,
  );
  const position = treasury?.positions.find((item) => item.strategy_id === matchingStrategy?.id) ?? null;
  const isOwner = Boolean(wallet.accountId && treasury && wallet.accountId === treasury.owner);
  const onChainBusy = Boolean(treasury?.operation_in_flight);

  const runTransaction = useCallback(async (label: string, operation: () => Promise<unknown>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await operation();
      setNotice(`${label} was submitted. Refreshing the on-chain treasury…`);
      window.setTimeout(() => void refreshTreasury(), 2_500);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  }, [refreshTreasury]);

  const requireOwnerExecution = () => {
    if (!treasuryConfigured || !wallet.treasuryContractId) throw new Error("Deploy and configure NEXT_PUBLIC_TREASURY_CONTRACT_ID first.");
    if (!wallet.accountId) throw new Error("Connect the treasury-owner wallet first.");
    if (treasury && !isOwner) throw new Error(`Connect the configured owner wallet: ${treasury.owner}`);
  };

  const requireAmount = () => {
    requireOwnerExecution();
    return parseTokenAmount(actionAmount, selectedAsset);
  };

  const syncPolicy = () => void runTransaction("Reserve policy", async () => {
    if (!treasuryConfigured || !wallet.treasuryContractId) throw new Error("The treasury contract is not configured.");
    if (!wallet.accountId) throw new Error("Connect the treasury-owner wallet first.");
    if (treasury && !isOwner) throw new Error(`Connect the configured owner wallet: ${treasury.owner}`);
    const obligationAtomic = parseTokenAmount(String(obligations), selectedAsset);
    await wallet.callMethod({
      receiverId: wallet.treasuryContractId,
      methodName: "set_asset_policy",
      args: {
        symbol: selectedAsset,
        obligations: obligationAtomic.toString(),
        safety_buffer_bps: bpsFromPercent(safetyBufferPercent),
        liquidity_holdback_bps: bpsFromPercent(liquidityHoldbackPercent, 10_000),
      },
    });
  });

  const fundVault = () => void runTransaction(`Fund ${selectedAsset} vault`, async () => {
    const amount = requireAmount();
    if (selectedAsset === "NEAR") {
      await wallet.callMethod({
        receiverId: wallet.treasuryContractId,
        methodName: "deposit_near",
        args: {},
        deposit: amount.toString(),
      });
      return;
    }
    const tokenId = tokenContractIds[selectedAsset];
    if (!tokenId) throw new Error(`${selectedAsset} token contract is not configured.`);
    await wallet.callMethod({
      receiverId: tokenId,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: wallet.treasuryContractId,
        amount: amount.toString(),
        memo: `Fund Veyra ${selectedAsset} treasury`,
        msg: "",
      },
      deposit: "1",
      gas: "100000000000000",
    });
  });

  const deploySurplus = () => void runTransaction(`Deploy ${selectedAsset} surplus`, async () => {
    const amount = requireAmount();
    await wallet.callMethod({
      receiverId: wallet.treasuryContractId,
      methodName: selectedAsset === "NEAR" ? "deploy_meta_pool" : "deploy_burrow",
      args: selectedAsset === "NEAR"
        ? { amount: amount.toString() }
        : { symbol: selectedAsset, amount: amount.toString() },
      gas: "180000000000000",
    });
  });

  const withdrawLiquid = () => void runTransaction(`Withdraw ${selectedAsset}`, async () => {
    const amount = requireAmount();
    await wallet.callMethod({
      receiverId: wallet.treasuryContractId,
      methodName: selectedAsset === "NEAR" ? "withdraw_near" : "withdraw_token",
      args: selectedAsset === "NEAR"
        ? { amount: amount.toString() }
        : { symbol: selectedAsset, amount: amount.toString() },
      gas: "100000000000000",
    });
  });

  const exitPosition = () => void runTransaction(`Exit ${matchingStrategy?.provider ?? "strategy"}`, async () => {
    if (!position) throw new Error("No active position exists for this asset.");
    requireOwnerExecution();
    await wallet.callMethod({
      receiverId: wallet.treasuryContractId,
      methodName: selectedAsset === "NEAR" ? "emergency_exit_meta_pool" : "emergency_exit_burrow",
      args: selectedAsset === "NEAR" ? {} : { symbol: selectedAsset },
      gas: "200000000000000",
    });
  });

  const routeStrategies = strategies.filter((strategy) => strategy.kind !== "reserve");

  return (
    <div className="page-stack treasury-page">
      <div className="page-heading treasury-heading">
        <div>
          <p className="eyebrow">Treasury</p>
          <h1>Protect cash. Put surplus to work.</h1>
          <p>Set aside upcoming obligations, keep a liquidity buffer, and deploy only the amount available after both.</p>
        </div>
        <div className="treasury-status-stack">
          <div className="market-feed">
            <span className={marketStatus === "live" ? "feed-dot live" : "feed-dot"} />
            <div><strong>{marketStatus === "loading" ? "Loading lending rates" : marketStatus === "live" ? "Lending rates updated" : "Live rates unavailable"}</strong><small>{marketAsOf ? `Updated ${new Date(marketAsOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Strategy details are still available"}</small></div>
          </div>
          <div className={treasuryConfigured ? "mode-badge live" : "mode-badge"}><i />{treasuryConfigured ? "Connected to testnet" : "Planning mode"}</div>
        </div>
      </div>

      <div className="asset-tabs" role="tablist" aria-label="Treasury asset">
        {assets.map((asset) => <button key={asset} className={selectedAsset === asset ? "active" : ""} onClick={() => setSelectedAsset(asset)} role="tab" aria-selected={selectedAsset === asset}>{asset}</button>)}
      </div>

      {(error || notice) && <div className={error ? "alert error-alert" : "alert success-alert"}>{error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{error || notice}</span></div>}

      <section className="treasury-planner-grid">
        <div className="panel treasury-controls">
          <div className="panel-heading"><div><p className="eyebrow">1 · Reserve policy</p><h2>Set the operating reserve</h2></div><ShieldCheck size={23} /></div>
          <div className="treasury-field-grid">
            <TreasuryField label="Treasury balance" suffix={selectedAsset} value={balance} onChange={setDemoBalance} readOnly={Boolean(chainAsset)} />
            <TreasuryField label="Next 30-day obligations" suffix={selectedAsset} value={obligations} onChange={setObligations} />
            <TreasuryField label="Safety buffer" suffix="%" value={safetyBufferPercent} onChange={setSafetyBufferPercent} />
            <TreasuryField label="Surplus held liquid" suffix="%" value={liquidityHoldbackPercent} onChange={setLiquidityHoldbackPercent} />
          </div>
          <div className="policy-lock"><LockKeyhole size={17} /><p><strong>Enforced by the vault</strong> The contract recalculates the available amount before every deployment. The configured operator cannot exceed it.</p></div>
          <button className="button button-outline button-full" disabled={busy || onChainBusy || !treasuryConfigured} onClick={syncPolicy}>{busy ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />} Save policy on-chain</button>
        </div>

        <div className={balance < protectedTarget ? "panel allocation-panel underfunded" : "panel allocation-panel"}>
          <div className="panel-heading"><div><p className="eyebrow">2 · Available funds</p><h2>{balance >= protectedTarget ? "Ready for allocation" : "Reserve needs funding"}</h2></div><Gauge size={23} /></div>
          <div className="allocation-number"><strong>{deployable.toFixed(2)}</strong><span>{selectedAsset} deployable now</span></div>
          <div className="allocation-bar" aria-label={`${liquidPercent.toFixed(0)} percent liquid and ${investedPercent.toFixed(0)} percent invested`}>
            <span className="allocation-liquid" style={{ width: `${liquidPercent}%` }} />
            <span className="allocation-yield" style={{ width: `${investedPercent}%` }} />
          </div>
          <div className="allocation-legend"><span><i className="liquid" />{liquid.toFixed(2)} liquid</span><span><i className="yield" />{invested.toFixed(2)} invested</span></div>
          <div className="plan-stats"><div><small>Protected target</small><strong>{protectedTarget.toFixed(2)} {selectedAsset}</strong></div><div><small>Runway coverage</small><strong>{obligations > 0 ? `${(balance / obligations).toFixed(1)}×` : "—"}</strong></div></div>
          {balance < protectedTarget && <div className="plan-warning"><AlertCircle size={16} />Treasury is {(protectedTarget - balance).toFixed(2)} {selectedAsset} below its protected target.</div>}
        </div>
      </section>

      <section className="panel execution-cockpit">
        <div className="execution-cockpit-copy">
          <p className="eyebrow">3 · Transactions</p>
          <h2>Fund, allocate, and withdraw</h2>
          <p>{treasuryConfigured ? `Vault ${shortId(wallet.treasuryContractId)} is configured. Every movement requires the owner wallet and produces an on-chain receipt.` : "Deploy the treasury contract to enable wallet-signed execution. The reserve planner remains available locally."}</p>
        </div>
        <div className="execution-amount">
          <label><span>Transaction amount</span><div><input value={actionAmount} inputMode="decimal" onChange={(event) => setActionAmount(event.target.value)} /><b>{selectedAsset}</b></div></label>
        </div>
        <div className="execution-action-grid">
          <button className="button button-dark" disabled={busy || onChainBusy || !treasuryConfigured} onClick={fundVault}><WalletCards size={17} /> Fund vault</button>
          <button className="button button-accent" disabled={busy || onChainBusy || !treasuryConfigured || deployable <= 0} onClick={deploySurplus}><TrendingUp size={17} /> Deploy surplus</button>
          <button className="button button-outline" disabled={busy || onChainBusy || !treasuryConfigured || liquid <= 0} onClick={withdrawLiquid}><ArrowUpFromLine size={17} /> Withdraw liquid</button>
          <button className="button button-outline danger-button" disabled={busy || onChainBusy || !position || position.status !== "active"} onClick={exitPosition}><ArrowDownToLine size={17} /> Emergency exit</button>
        </div>
        {onChainBusy && <div className="operation-pending"><RefreshCw className="spin" size={15} /> A cross-contract operation is still resolving. New movements are locked.</div>}
      </section>

      <section>
        <div className="strategy-section-heading"><div><p className="eyebrow">4 · Strategies</p><h2>Compare the available routes</h2></div><p>Rates are variable and not guaranteed. Only the route for the selected asset can be used.</p></div>
        <div className="strategy-grid">
          {routeStrategies.map((strategy) => (
            <StrategyCard
              key={strategy.id}
              strategy={strategy}
              active={strategy.id === matchingStrategy?.id}
              position={treasury?.positions.find((item) => item.strategy_id === strategy.id) ?? null}
            />
          ))}
        </div>
      </section>

      <section className="panel route-panel">
        <div className="route-icon"><Zap size={22} /></div>
        <div><p className="eyebrow">Selected route</p><h2>{deployable.toFixed(2)} {selectedAsset} available for {matchingStrategy?.provider ?? "the selected provider"}</h2><p>Funding, policy updates, allocation, and exits are signed by the owner wallet. The vault records principal and reconciles realized yield or loss.</p></div>
        <span className={treasuryConfigured ? "simulation-badge live" : "simulation-badge"}>{treasuryConfigured ? "Ready on testnet" : "Planning only"}</span>
      </section>

      <div className="defi-disclaimer"><ShieldCheck size={16} /><p>Meta Pool uses its published testnet contract when configured. Stablecoin lending can point to Burrow or the protocol-compatible mock adapter included with Veyra. Test deployments are not audited production vaults.</p></div>
    </div>
  );
}

function TreasuryField({ label, suffix, value, onChange, readOnly = false }: { label: string; suffix: string; value: number; onChange: (value: number) => void; readOnly?: boolean }) {
  return <label className="treasury-field"><span>{label}</span><div><input type="number" min="0" step="0.01" value={Number.isFinite(value) ? value : 0} readOnly={readOnly} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} /><b>{suffix}</b></div></label>;
}

function StrategyCard({ strategy, active, position }: { strategy: YieldStrategy; active: boolean; position: ChainTreasuryPosition | null }) {
  const apy = strategy.currentApy === null ? "Variable" : `${strategy.currentApy.toFixed(2)}%`;
  const decimals = strategy.depositAsset === "NEAR" ? 24 : 6;
  return (
    <article className={active ? "strategy-card active" : "strategy-card"}>
      <div className="strategy-top"><span className={`strategy-kind ${strategy.kind}`}>{strategy.kind === "liquid-staking" ? "Liquid staking" : "Lending"}</span><a href={strategy.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${strategy.provider} source`}><ExternalLink size={16} /></a></div>
      <div className="strategy-provider"><span>{strategy.provider.slice(0, 1)}</span><div><small>{strategy.provider}</small><h3>{strategy.name}</h3></div></div>
      <div className="strategy-rate"><strong>{apy}</strong><span>{strategy.quoteStatus === "live" ? "live supply APY" : strategy.kind === "liquid-staking" ? "variable staking yield" : "rate unavailable"}</span></div>
      <p>{strategy.description}</p>
      <div className="strategy-facts"><div><small>Asset route</small><strong>{strategy.depositAsset} → {strategy.receiptAsset}</strong></div><div><small>Exit</small><strong>{strategy.exitWindow}</strong></div>{position && <div><small>On-chain principal</small><strong>{formatAtomic(position.principal, decimals)} {strategy.depositAsset}</strong></div>}{strategy.availableLiquidityUsd !== null && <div><small>Available liquidity</small><strong>{formatUsd(strategy.availableLiquidityUsd)}</strong></div>}</div>
      <div className="risk-row"><span>Risk tier {strategy.riskTier}/5</span><div>{Array.from({ length: 5 }, (_, index) => <i className={index < strategy.riskTier ? "on" : ""} key={index} />)}</div></div>
      <div className="strategy-state"><span className={active ? "active" : ""}>{active ? "Selected route" : "Select matching asset"}</span>{position?.status === "active" && <span className="position-live"><i /> Position live</span>}</div>
      <details><summary>What can go wrong?</summary><ul>{strategy.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></details>
    </article>
  );
}

function shortId(value: string) {
  return value.length > 26 ? `${value.slice(0, 13)}…${value.slice(-9)}` : value;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}
