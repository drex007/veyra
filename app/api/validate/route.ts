import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluatePayments, isValidNearAccountId } from "@/lib/agent";
import { accountExists } from "@/lib/near-rpc";
import { analyzePaymentBatch } from "@/lib/openai-agent";
import { enforceReadinessDecisions, runPaymentReadinessAgent } from "@/lib/treasury-agent";
import { paymentTotals } from "@/lib/amounts";

const paymentSchema = z.object({
  id: z.string(),
  recipient: z.string(),
  amount: z.string(),
  token: z.enum(["NEAR", "USDC", "USDT"]).default("NEAR"),
  memo: z.string(),
  status: z.enum(["pending", "processing", "success", "failed", "cancelled"]),
  valid: z.boolean(),
  exists: z.boolean().nullable(),
  riskScore: z.number(),
  issues: z.array(z.string()),
  txHash: z.string().optional(),
});

const requestSchema = z.object({
  payments: z.array(paymentSchema).min(1).max(1_000),
  policy: z.object({
    maxPerRecipient: z.number().positive().max(1_000_000),
    requireExistingAccount: z.boolean(),
    blockDuplicates: z.boolean(),
    useOpenAI: z.boolean(),
  }),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const uniqueAccounts = [...new Set(body.payments.map((item) => item.recipient))];
    let cursor = 0;
    const checks: Array<readonly [string, boolean | null]> = new Array(uniqueAccounts.length);
    await Promise.all(Array.from({ length: Math.min(20, uniqueAccounts.length) }, async () => {
      while (cursor < uniqueAccounts.length) {
        const index = cursor;
        cursor += 1;
        const accountId = uniqueAccounts[index];
        checks[index] = [accountId, isValidNearAccountId(accountId) ? await accountExists(accountId) : false] as const;
      }
    }));
    const accountExistence = Object.fromEntries(checks);
    const validation = evaluatePayments(body.payments, body.policy, accountExistence);
    const [aiAnalysis, treasuryAgent] = await Promise.all([
      analyzePaymentBatch(validation.payments, body.policy.useOpenAI),
      runPaymentReadinessAgent(validation.payments, body.policy.useOpenAI),
    ]);
    const payments = enforceReadinessDecisions(validation.payments, treasuryAgent.paymentDecisions);
    const acceptedPayments = payments.filter((payment) => payment.valid);
    const totalsAccepted = paymentTotals(acceptedPayments);
    return NextResponse.json({
      ...validation,
      payments,
      accepted: acceptedPayments.length,
      rejected: payments.length - acceptedPayments.length,
      warnings: payments.filter((payment) => payment.valid && payment.issues.length > 0).length,
      totalAccepted: totalsAccepted.find(({ token }) => token === "NEAR")?.amount ?? 0,
      totalsAccepted,
      aiAnalysis,
      treasuryAgent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
