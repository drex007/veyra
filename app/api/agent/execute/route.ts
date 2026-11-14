import { NextResponse } from "next/server";
import { z } from "zod";
import { executePaymentBatchChunk, getPaymentAgentStatus, isPaymentAgentConfigured } from "@/lib/near-agent";

const requestSchema = z.object({
  batchIds: z.array(z.number().int().nonnegative()).min(1).max(10),
  maxItems: z.number().int().min(1).max(10).default(5),
});

export async function GET() {
  return NextResponse.json(await getPaymentAgentStatus());
}

export async function POST(request: Request) {
  if (!isPaymentAgentConfigured()) {
    return NextResponse.json({ error: "Configure VEYRA_AGENT_ACCOUNT_ID and VEYRA_AGENT_PRIVATE_KEY on the server." }, { status: 503 });
  }
  try {
    const { batchIds, maxItems } = requestSchema.parse(await request.json());
    let remaining = maxItems;
    const batches = [];
    for (const batchId of [...new Set(batchIds)]) {
      if (remaining <= 0) break;
      const result = await executePaymentBatchChunk(batchId, remaining);
      batches.push(result);
      remaining -= result.processed;
    }
    return NextResponse.json({ batches, processed: maxItems - remaining });
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Payment agent execution failed" },
      { status: invalid ? 400 : 409 },
    );
  }
}
