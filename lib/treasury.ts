import type { PaymentToken } from "@/lib/types";

export interface ChainAssetPolicy {
  obligations: string;
  safety_buffer_bps: number;
  liquidity_holdback_bps: number;
}

export interface ChainTreasuryAsset {
  symbol: PaymentToken;
  decimals: number;
  token_id: string | null;
  liquid: string;
  invested: string;
  total: string;
  reserve_target: string;
  deployable: string;
  policy: ChainAssetPolicy;
}

export interface ChainTreasuryPosition {
  strategy_id: string;
  asset: PaymentToken;
  provider_id: string;
  principal: string;
  receipt_units: string;
  total_deposited: string;
  total_withdrawn: string;
  realized_yield: string;
  realized_loss: string;
  status: "active" | "closed";
  updated_at_ms: number;
}

export interface ChainTreasurySnapshot {
  owner: string;
  agent: string;
  meta_pool_id: string;
  burrow_id: string;
  operation_in_flight: boolean;
  assets: ChainTreasuryAsset[];
  positions: ChainTreasuryPosition[];
}

export function formatAtomic(value: string | bigint, decimals: number, maximumFractionDigits = 4): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const factor = 10n ** BigInt(decimals);
  const whole = amount / factor;
  const fraction = (amount % factor).toString().padStart(decimals, "0");
  const visible = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return visible ? `${whole}.${visible}` : whole.toString();
}

export function bpsFromPercent(value: number, maximumBps = 20_000): number {
  return Math.min(maximumBps, Math.max(0, Math.round(value * 100)));
}
