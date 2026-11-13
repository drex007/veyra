import { NextResponse } from "next/server";
import { viewContract } from "@/lib/near-rpc";

interface ContractConfig {
  admin: string;
  agent: string;
  next_batch_id: string;
  max_batch_size: number;
  supported_tokens: Array<{ token_id: string; symbol: string; decimals: number }>;
}

export async function GET() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!contractId) {
    return NextResponse.json({ error: "Contract is not configured" }, { status: 404 });
  }
  try {
    return NextResponse.json(await viewContract<ContractConfig>(contractId, "get_config", {}));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read contract config" },
      { status: 502 },
    );
  }
}
