import type { CsvPayment, PaymentToken, TokenTotal } from "@/lib/types";

export const TOKEN_DECIMALS: Record<PaymentToken, number> = {
  NEAR: 24,
  USDC: 6,
  USDT: 6,
};

const YOCTO_FACTOR = 10n ** 24n;

export function parseTokenAmount(value: string, token: PaymentToken): bigint {
  const decimals = TOKEN_DECIMALS[token];
  const normalized = value.trim();
  const expression = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!expression.test(normalized)) {
    throw new Error(`Enter a positive ${token} amount with no more than ${decimals} decimals.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const factor = 10n ** BigInt(decimals);
  return BigInt(whole) * factor + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function parseNear(value: string): bigint {
  return parseTokenAmount(value, "NEAR");
}

export function formatNear(value: bigint | string, maximumFractionDigits = 4): string {
  const amount = typeof value === "string" ? BigInt(value) : value;
  const whole = amount / YOCTO_FACTOR;
  const fraction = (amount % YOCTO_FACTOR).toString().padStart(24, "0");
  const visible = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return visible ? `${whole}.${visible}` : whole.toString();
}

export function sumNear(values: string[]): bigint {
  return values.reduce((sum, value) => sum + parseNear(value), 0n);
}

export function sumTokenAmounts(values: string[], token: PaymentToken): bigint {
  return values.reduce((sum, value) => sum + parseTokenAmount(value, token), 0n);
}

export function paymentTotals(payments: Pick<CsvPayment, "amount" | "token">[]): TokenTotal[] {
  const totals = new Map<PaymentToken, number>();
  payments.forEach((payment) => totals.set(payment.token ?? "NEAR", (totals.get(payment.token ?? "NEAR") ?? 0) + Number(payment.amount || 0)));
  return (["NEAR", "USDC", "USDT"] as PaymentToken[])
    .filter((token) => (totals.get(token) ?? 0) > 0)
    .map((token) => ({ token, amount: totals.get(token) ?? 0 }));
}

export function formatTokenTotals(totals: TokenTotal[]): string {
  return totals.length ? totals.map(({ amount, token }) => `${amount.toFixed(2)} ${token}`).join(" · ") : "0.00 NEAR";
}
