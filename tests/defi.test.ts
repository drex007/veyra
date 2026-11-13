import { describe, expect, it } from "vitest";
import { calculateTreasuryPlan, mergeBurrowMarkets, strategyRegistry } from "@/lib/defi";
import { parseBurrowMarkets } from "@/lib/defi-market";

describe("treasury reserve policy", () => {
  it("protects obligations, buffer and a share of surplus", () => {
    const plan = calculateTreasuryPlan({
      balanceNear: 1_000,
      obligationsNear: 500,
      safetyBufferPercent: 20,
      liquidityHoldbackPercent: 30,
    });

    expect(plan.reserveTargetNear).toBe(600);
    expect(plan.liquidityHoldbackNear).toBe(120);
    expect(plan.deployableNear).toBe(280);
    expect(plan.totalLiquidNear).toBe(720);
    expect(plan.status).toBe("protected");
  });

  it("never deploys funds when the protected reserve is underfunded", () => {
    const plan = calculateTreasuryPlan({
      balanceNear: 400,
      obligationsNear: 500,
      safetyBufferPercent: 20,
      liquidityHoldbackPercent: 30,
    });

    expect(plan.deployableNear).toBe(0);
    expect(plan.status).toBe("underfunded");
    expect(plan.warning).toContain("200.00 NEAR");
  });
});

describe("Burrow market data", () => {
  it("parses valid market rows and ignores malformed rows", () => {
    const markets = parseBurrowMarkets({
      code: "0",
      data: [
        { symbol: "USDC", token: "usdc", supply_apy: "9.68", available_liquidity_price: "1939559.11" },
        { symbol: "BROKEN", token: null, supply_apy: "x", available_liquidity_price: null },
      ],
    });
    expect(markets).toEqual([{ symbol: "USDC", token: "usdc", supplyApy: 9.68, availableLiquidityUsd: 1939559.11 }]);
  });

  it("adds live quotes only to matching allowlisted strategies", () => {
    const merged = mergeBurrowMarkets(strategyRegistry, [{
      symbol: "USDC",
      token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      supplyApy: 9.68,
      availableLiquidityUsd: 1_939_559,
    }]);
    const usdc = merged.find((strategy) => strategy.id === "burrow-usdc");
    expect(usdc?.quoteStatus).toBe("live");
    expect(usdc?.currentApy).toBe(9.68);
    expect(merged.find((strategy) => strategy.id === "burrow-usdt")?.quoteStatus).toBe("unavailable");
  });
});
