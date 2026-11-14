import { connect, KeyPair, keyStores } from "near-api-js";
import { viewContract } from "@/lib/near-rpc";

interface ContractConfig {
  agent: string;
}

export interface AgentBatchItem {
  recipient: string;
  amount: string;
  status: "pending" | "processing" | "success" | "failed" | "cancelled";
  error?: string | null;
}

export interface AgentBatchSnapshot {
  id: string;
  owner: string;
  status: "ready" | "processing" | "complete" | "cancelled";
  items: AgentBatchItem[];
}

export interface AgentExecutionResult {
  batchId: number;
  processed: number;
  transactionHashes: string[];
  processedItems: Array<{ index: number; transactionHash?: string }>;
  snapshot: AgentBatchSnapshot;
}

const activeBatches = new Set<number>();
let signerBusy = false;

export function isPaymentAgentConfigured(): boolean {
  return Boolean(
    process.env.VEYRA_AGENT_ACCOUNT_ID &&
    process.env.VEYRA_AGENT_PRIVATE_KEY &&
    process.env.NEXT_PUBLIC_CONTRACT_ID,
  );
}

export async function getPaymentAgentStatus(): Promise<{ configured: boolean; accountId?: string; error?: string }> {
  if (!isPaymentAgentConfigured()) return { configured: false, error: "Server agent credentials are not configured" };
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID!;
  const accountId = process.env.VEYRA_AGENT_ACCOUNT_ID!;
  try {
    const config = await viewContract<ContractConfig>(contractId, "get_config", {});
    if (config.agent !== accountId) {
      return { configured: false, accountId, error: `Contract agent is ${config.agent}, not ${accountId}` };
    }
    return { configured: true, accountId };
  } catch (error) {
    return { configured: false, accountId, error: error instanceof Error ? error.message : "Could not verify the contract agent" };
  }
}

async function getAgentAccount() {
  const accountId = process.env.VEYRA_AGENT_ACCOUNT_ID;
  const privateKey = process.env.VEYRA_AGENT_PRIVATE_KEY;
  if (!accountId || !privateKey) throw new Error("The server payment agent is not configured");
  const networkId = process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet";
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(privateKey as Parameters<typeof KeyPair.fromString>[0]);
  await keyStore.setKey(networkId, accountId, keyPair);
  const near = await connect({
    networkId,
    nodeUrl: process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
    keyStore,
  });
  return near.account(accountId);
}

function transactionHash(outcome: unknown): string | undefined {
  if (!outcome || typeof outcome !== "object") return undefined;
  return (outcome as { transaction?: { hash?: string } }).transaction?.hash;
}

export async function executePaymentBatchChunk(batchId: number, limit: number): Promise<AgentExecutionResult> {
  if (!isPaymentAgentConfigured()) throw new Error("The server payment agent is not configured");
  if (signerBusy) throw new Error("The server payment agent is busy; retry this settlement chunk shortly");
  if (activeBatches.has(batchId)) throw new Error("This batch is already being processed by the agent");
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID!;
  const agentId = process.env.VEYRA_AGENT_ACCOUNT_ID!;
  activeBatches.add(batchId);
  signerBusy = true;
  try {
    const [config, initial] = await Promise.all([
      viewContract<ContractConfig>(contractId, "get_config", {}),
      viewContract<AgentBatchSnapshot | null>(contractId, "get_batch", { batch_id: batchId }),
    ]);
    if (!initial) throw new Error(`Contract batch ${batchId} was not found`);
    if (config.agent !== agentId) throw new Error(`Configured signer ${agentId} is not the contract agent ${config.agent}`);
    if (initial.status === "complete" || initial.status === "cancelled") {
      return { batchId, processed: 0, transactionHashes: [], processedItems: [], snapshot: initial };
    }

    const account = await getAgentAccount();
    const transactionHashes: string[] = [];
    const processedItems: Array<{ index: number; transactionHash?: string }> = [];
    if (initial.status === "ready") {
      const outcome = await account.callFunctionRaw({
        contractId,
        methodName: "start_processing",
        args: { batch_id: batchId },
        gas: 30_000_000_000_000n,
        waitUntil: "FINAL",
      });
      const hash = transactionHash(outcome);
      if (hash) transactionHashes.push(hash);
    }

    let snapshot = await viewContract<AgentBatchSnapshot>(contractId, "get_batch", { batch_id: batchId });
    const pending = snapshot.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === "pending")
      .slice(0, limit);
    let processed = 0;
    for (const { index } of pending) {
      const outcome = await account.callFunctionRaw({
        contractId,
        methodName: "process_item",
        args: { batch_id: batchId, index },
        gas: 55_000_000_000_000n,
        waitUntil: "FINAL",
      });
      const hash = transactionHash(outcome);
      if (hash) transactionHashes.push(hash);
      processedItems.push({ index, transactionHash: hash });
      processed += 1;
    }
    snapshot = await viewContract<AgentBatchSnapshot>(contractId, "get_batch", { batch_id: batchId });
    return { batchId, processed, transactionHashes, processedItems, snapshot };
  } finally {
    activeBatches.delete(batchId);
    signerBusy = false;
  }
}
