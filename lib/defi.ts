export type StrategyKind = "reserve" | "liquid-staking" | "lending";
export type QuoteStatus = "not-applicable" | "live" | "unavailable";

export interface YieldStrategy {
  id: string;
  name: string;
  provider: string;
  kind: StrategyKind;
  depositAsset: string;
  receiptAsset: string;
  contractId?: string;
  riskTier: 1 | 2 | 3 | 4 | 5;
  exitWindow: string;
  currentApy: number | null;
  quoteStatus: QuoteStatus;
  availableLiquidityUsd: number | null;
  description: string;
  risks: string[];
  sourceUrl: string;
}

export interface BurrowMarket {
  symbol: string;
  token: string;
  supplyApy: number;
  availableLiquidityUsd: number;
}

export interface TreasuryPlanInput {
  balanceNear: number;
  obligationsNear: number;
  safetyBufferPercent: number;
  liquidityHoldbackPercent: number;
}

export interface TreasuryPlan {
  balanceNear: number;
  reserveTargetNear: number;
  liquidityHoldbackNear: number;
  deployableNear: number;
  totalLiquidNear: number;
  runwayCoverage: number | null;
  status: "protected" | "underfunded";
  warning: string | null;
}

export const strategyRegistry: YieldStrategy[] = [
  {
    id: "veyra-reserve",
    name: "Payroll reserve",
    provider: "Veyra",
    kind: "reserve",
    depositAsset: "NEAR",
    receiptAsset: "NEAR",
    riskTier: 1,
    exitWindow: "Immediate",
    currentApy: 0,
    quoteStatus: "not-applicable",
    availableLiquidityUsd: null,
    description: "Ring-fenced operating funds. This balance is never sent to a yield protocol.",
    risks: ["No protocol yield", "NEAR price exposure"],
    sourceUrl: "https://docs.near.org/protocol/basics/accounts/state",
  },
  {
    id: "meta-pool-stnear",
    name: "Liquid NEAR staking",
    provider: "Meta Pool",
    kind: "liquid-staking",
    depositAsset: "NEAR",
    receiptAsset: "stNEAR",
    contractId: process.env.NEXT_PUBLIC_META_POOL_CONTRACT_ID
      ?? (process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "meta-pool.near" : "meta-v2.pool.testnet"),
    riskTier: 2,
    exitWindow: "Instant with a variable fee, or delayed unstake",
    currentApy: null,
    quoteStatus: "unavailable",
    availableLiquidityUsd: null,
    description: "Stake surplus NEAR while retaining an stNEAR position that can be exited when payroll needs liquidity.",
    risks: ["Smart-contract risk", "Instant-exit fee and liquidity", "Validator and staking risk"],
    sourceUrl: "https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network",
  },
  {
    id: "burrow-usdc",
    name: "USDC lending",
    provider: "Burrow",
    kind: "lending",
    depositAsset: "USDC",
    receiptAsset: "Burrow supply position",
    contractId: process.env.NEXT_PUBLIC_BURROW_CONTRACT_ID ?? "contract.main.burrow.near",
    riskTier: 3,
    exitWindow: "On demand, subject to market liquidity",
    currentApy: null,
    quoteStatus: "unavailable",
    availableLiquidityUsd: null,
    description: "Supply stable treasury funds to NEAR's lending market. NEAR-to-USDC conversion is quoted separately through Intents.",
    risks: ["Smart-contract risk", "Stablecoin depeg risk", "Utilization can constrain withdrawals", "Variable rate"],
    sourceUrl: "https://burrowfi.app/",
  },
  {
    id: "burrow-usdt",
    name: "USDt lending",
    provider: "Burrow",
    kind: "lending",
    depositAsset: "USDt",
    receiptAsset: "Burrow supply position",
    contractId: process.env.NEXT_PUBLIC_BURROW_CONTRACT_ID ?? "contract.main.burrow.near",
    riskTier: 3,
    exitWindow: "On demand, subject to market liquidity",
    currentApy: null,
    quoteStatus: "unavailable",
    availableLiquidityUsd: null,
    description: "A second stablecoin lending lane for treasuries already holding native USDt on NEAR.",
    risks: ["Smart-contract risk", "Stablecoin depeg risk", "Utilization can constrain withdrawals", "Variable rate"],
    sourceUrl: "https://burrowfi.app/",
  },
];

const burrowTokenByStrategy: Record<string, string> = {
  "burrow-usdc": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "burrow-usdt": "usdt.tether-token.near",
};

export function mergeBurrowMarkets(
  strategies: YieldStrategy[],
  markets: BurrowMarket[],
): YieldStrategy[] {
  const marketsByToken = new Map(markets.map((market) => [market.token, market]));
  return strategies.map((strategy) => {
    const token = burrowTokenByStrategy[strategy.id];
    const market = token ? marketsByToken.get(token) : undefined;
    if (!market) return { ...strategy };
    return {
      ...strategy,
      currentApy: market.supplyApy,
      quoteStatus: "live",
      availableLiquidityUsd: market.availableLiquidityUsd,
    };
  });
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateTreasuryPlan(input: TreasuryPlanInput): TreasuryPlan {
  const balanceNear = finiteNonNegative(input.balanceNear);
  const obligationsNear = finiteNonNegative(input.obligationsNear);
  const safetyBufferPercent = Math.min(200, finiteNonNegative(input.safetyBufferPercent));
  const liquidityHoldbackPercent = Math.min(100, finiteNonNegative(input.liquidityHoldbackPercent));
  const reserveTargetNear = obligationsNear * (1 + safetyBufferPercent / 100);
  const surplusNear = Math.max(0, balanceNear - reserveTargetNear);
  const liquidityHoldbackNear = surplusNear * (liquidityHoldbackPercent / 100);
  const deployableNear = Math.max(0, surplusNear - liquidityHoldbackNear);
  const underfundedBy = Math.max(0, reserveTargetNear - balanceNear);

  return {
    balanceNear,
    reserveTargetNear,
    liquidityHoldbackNear,
    deployableNear,
    totalLiquidNear: Math.min(balanceNear, reserveTargetNear) + liquidityHoldbackNear,
    runwayCoverage: obligationsNear > 0 ? balanceNear / obligationsNear : null,
    status: underfundedBy > 0 ? "underfunded" : "protected",
    warning: underfundedBy > 0
      ? `Treasury is ${underfundedBy.toFixed(2)} NEAR below the protected reserve target.`
      : null,
  };
}
