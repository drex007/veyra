import { NextResponse } from "next/server";
import { z } from "zod";
import { investigatePaymentBatch } from "@/lib/payment-investigation";

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
  contractBatchId: z.number().int().nonnegative().optional(),
  contractItemIndex: z.number().int().nonnegative().optional(),
});

const requestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  batch: z.object({
    id: z.string(),
    name: z.string(),
    owner: z.string(),
    createdAt: z.string(),
    status: z.enum(["draft", "ready", "processing", "complete", "cancelled"]),
    payments: z.array(paymentSchema).min(1).max(1_000),
    total: z.number().nonnegative(),
    totals: z.array(z.object({ token: z.enum(["NEAR", "USDC", "USDT"]), amount: z.number().nonnegative() })).optional(),
    assets: z.array(z.object({
      token: z.enum(["NEAR", "USDC", "USDT"]),
      total: z.number().nonnegative(),
      contractBatchId: z.number().int().nonnegative().optional(),
      fundingTxHash: z.string().optional(),
    })).optional(),
    txHash: z.string().optional(),
    contractBatchId: z.number().int().nonnegative().optional(),
    mode: z.enum(["demo", "contract"]),
  }),
});

export async function POST(request: Request) {
  try {
    const { batch, question } = requestSchema.parse(await request.json());
    return NextResponse.json(await investigatePaymentBatch(batch, question));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment investigation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
