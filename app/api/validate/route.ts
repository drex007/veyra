import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluatePayments, isValidNearAccountId } from "@/lib/agent";
import { accountExists } from "@/lib/near-rpc";
import { analyzePaymentBatch } from "@/lib/openai-agent";

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
  payments: z.array(paymentSchema).min(1).max(200),
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
    const checks = await Promise.all(
      uniqueAccounts.map(async (accountId) => [
        accountId,
        isValidNearAccountId(accountId) ? await accountExists(accountId) : false,
      ] as const),
    );
    const accountExistence = Object.fromEntries(checks);
    const validation = evaluatePayments(body.payments, body.policy, accountExistence);
    const aiAnalysis = await analyzePaymentBatch(validation.payments, body.policy.useOpenAI);
    return NextResponse.json({ ...validation, aiAnalysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
