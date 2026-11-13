import { parseTokenAmount, paymentTotals } from "@/lib/amounts";
import { CsvPayment, ValidationPolicy, ValidationSummary } from "@/lib/types";

const ACCOUNT_ID_PATTERN = /^(?=.{2,64}$)(?!.*\.\.)(?!.*[-_.]{2})[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

export function isValidNearAccountId(accountId: string): boolean {
  return ACCOUNT_ID_PATTERN.test(accountId);
}

export function evaluatePayments(
  payments: CsvPayment[],
  policy: ValidationPolicy,
  accountExistence: Record<string, boolean | null> = {},
): ValidationSummary {
  const counts = new Map<string, number>();
  const amountsByToken = new Map<string, number[]>();
  payments.forEach(({ recipient, token }) => {
    const key = `${recipient}:${token ?? "NEAR"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  payments.forEach(({ amount, token }) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;
    const symbol = token ?? "NEAR";
    amountsByToken.set(symbol, [...(amountsByToken.get(symbol) ?? []), numericAmount]);
  });
  const medians = new Map<string, number>();
  amountsByToken.forEach((amounts, token) => {
    if (amounts.length < 4) return;
    const sorted = [...amounts].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    medians.set(token, sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
  });

  const evaluated = payments.map((payment) => {
    const issues: string[] = [];
    let riskScore = 0;
    const exists = accountExistence[payment.recipient] ?? null;

    if (!isValidNearAccountId(payment.recipient)) {
      issues.push("Invalid NEAR account format");
      riskScore += 100;
    }

    let numericAmount = 0;
    try {
      const atomicAmount = parseTokenAmount(payment.amount, payment.token ?? "NEAR");
      numericAmount = Number(payment.amount);
      if (atomicAmount <= 0n) throw new Error("non-positive");
    } catch {
      issues.push("Invalid payment amount");
      riskScore += 100;
    }

    if (numericAmount > policy.maxPerRecipient) {
      issues.push(`Exceeds ${policy.maxPerRecipient} ${payment.token ?? "NEAR"} policy limit`);
      riskScore += 80;
    }

    if (policy.blockDuplicates && (counts.get(`${payment.recipient}:${payment.token ?? "NEAR"}`) ?? 0) > 1) {
      issues.push("Duplicate recipient");
      riskScore += 75;
    }

    const token = payment.token ?? "NEAR";
    const median = medians.get(token);
    if (median && numericAmount >= median * 3) {
      issues.push(`Unusual amount: ${(numericAmount / median).toFixed(1)}× above the ${token} batch median`);
      riskScore += 35;
    }

    if (exists === false) {
      issues.push("Account was not found on testnet");
      riskScore += policy.requireExistingAccount ? 100 : 35;
    }

    const blocking = riskScore >= 75;
    return {
      ...payment,
      exists,
      issues,
      riskScore: Math.min(riskScore, 100),
      valid: !blocking,
    };
  });

  const accepted = evaluated.filter((payment) => payment.valid);
  const totalsAccepted = paymentTotals(accepted);
  return {
    payments: evaluated,
    accepted: accepted.length,
    rejected: evaluated.length - accepted.length,
    warnings: evaluated.filter((payment) => payment.valid && payment.issues.length > 0).length,
    totalAccepted: totalsAccepted.find(({ token }) => token === "NEAR")?.amount ?? 0,
    totalsAccepted,
    checkedAt: new Date().toISOString(),
  };
}
