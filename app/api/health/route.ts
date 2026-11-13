import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "veyra-agent",
    network: process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet",
    contractConfigured: Boolean(process.env.NEXT_PUBLIC_CONTRACT_ID),
    treasuryContractConfigured: Boolean(process.env.NEXT_PUBLIC_TREASURY_CONTRACT_ID),
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    timestamp: new Date().toISOString(),
  });
}
