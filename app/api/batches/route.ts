import { NextResponse } from "next/server";
import { z } from "zod";
import { getBatchesFromDatabase, isDatabaseConfigured, saveBatchToDatabase } from "@/lib/db";

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

const batchSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  createdAt: z.string(),
  status: z.enum(["draft", "ready", "processing", "complete", "cancelled"]),
  payments: z.array(paymentSchema).max(200),
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
});

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ configured: false, batches: [] });
  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner) return NextResponse.json({ error: "owner is required" }, { status: 400 });
  try {
    return NextResponse.json({ configured: true, batches: await getBatchesFromDatabase(owner) });
  } catch (error) {
    console.error("Veyra database read failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database read failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ configured: false, persisted: false }, { status: 202 });
  try {
    const batch = batchSchema.parse(await request.json());
    await saveBatchToDatabase(batch);
    return NextResponse.json({ configured: true, persisted: true });
  } catch (error) {
    const isInvalidRequest = error instanceof z.ZodError;
    if (!isInvalidRequest) console.error("Veyra database write failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database write failed" },
      { status: isInvalidRequest ? 400 : 500 },
    );
  }
}
