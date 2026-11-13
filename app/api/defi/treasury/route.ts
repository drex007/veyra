import { NextResponse } from "next/server";
import { viewContract } from "@/lib/near-rpc";
import type { ChainTreasurySnapshot } from "@/lib/treasury";

export const dynamic = "force-dynamic";

export async function GET() {
  const contractId = process.env.NEXT_PUBLIC_TREASURY_CONTRACT_ID;
  if (!contractId) {
    return NextResponse.json({ configured: false, treasury: null });
  }
  try {
    const treasury = await viewContract<ChainTreasurySnapshot>(contractId, "get_treasury", {});
    return NextResponse.json({ configured: true, contractId, treasury });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        contractId,
        treasury: null,
        error: error instanceof Error ? error.message : "Could not read the treasury contract",
      },
      { status: 502 },
    );
  }
}
