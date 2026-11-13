import { getStrategySnapshot } from "@/lib/defi-market";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getStrategySnapshot();
  return Response.json(snapshot, {
    headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
