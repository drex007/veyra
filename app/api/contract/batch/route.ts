import { NextResponse } from "next/server";
import { z } from "zod";
import { viewContract } from "@/lib/near-rpc";

interface ContractBatch {
  id: string;
  status: string;
  items: Array<{
    recipient: string;
    amount: string;
    status: string;
    error?: string | null;
  }>;
}

const batchIdSchema = z.coerce.number().int().nonnegative();

export async function GET(request: Request) {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!contractId) return NextResponse.json({ error: "Payment contract is not configured" }, { status: 503 });
  const parsed = batchIdSchema.safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) return NextResponse.json({ error: "A non-negative batch id is required" }, { status: 400 });
  try {
    const batch = await viewContract<ContractBatch | null>(contractId, "get_batch", { batch_id: parsed.data });
    if (!batch) return NextResponse.json({ error: "Contract batch was not found" }, { status: 404 });
    return NextResponse.json(batch);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Contract batch lookup failed" }, { status: 502 });
  }
}
