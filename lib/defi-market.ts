import { mergeBurrowMarkets, strategyRegistry, type BurrowMarket, type YieldStrategy } from "@/lib/defi";

const BURROW_MARKET_URL = "https://api.burrow.finance/list_token_data";

interface BurrowMarketRow {
  symbol?: unknown;
  token?: unknown;
  supply_apy?: unknown;
  available_liquidity_price?: unknown;
}

interface BurrowResponse {
  code?: unknown;
  data?: unknown;
}

export interface StrategySnapshot {
  strategies: YieldStrategy[];
  marketStatus: "live" | "degraded";
  asOf: string;
}

export function parseBurrowMarkets(payload: BurrowResponse): BurrowMarket[] {
  if (payload.code !== "0" || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((row): BurrowMarket[] => {
    const market = row as BurrowMarketRow;
    if (typeof market.symbol !== "string" || typeof market.token !== "string") return [];
    const supplyApy = Number(market.supply_apy);
    const availableLiquidityUsd = Number(market.available_liquidity_price);
    if (!Number.isFinite(supplyApy) || !Number.isFinite(availableLiquidityUsd)) return [];
    return [{ symbol: market.symbol, token: market.token, supplyApy, availableLiquidityUsd }];
  });
}

export async function getStrategySnapshot(): Promise<StrategySnapshot> {
  const asOf = new Date().toISOString();
  try {
    const response = await fetch(BURROW_MARKET_URL, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`Burrow returned ${response.status}`);
    const markets = parseBurrowMarkets((await response.json()) as BurrowResponse);
    if (!markets.length) throw new Error("Burrow returned no valid markets");
    return {
      strategies: mergeBurrowMarkets(strategyRegistry, markets),
      marketStatus: "live",
      asOf,
    };
  } catch {
    return {
      strategies: strategyRegistry.map((strategy) => ({ ...strategy })),
      marketStatus: "degraded",
      asOf,
    };
  }
}
