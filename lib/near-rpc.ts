const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

interface RpcResult<T> {
  result?: T;
  error?: { message?: string; cause?: { name?: string } };
}

export async function nearRpc<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "veyra", method, params }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`NEAR RPC returned ${response.status}`);
  const payload = (await response.json()) as RpcResult<T>;
  if (payload.error) throw new Error(payload.error.message ?? "NEAR RPC request failed");
  if (payload.result === undefined) throw new Error("NEAR RPC returned no result");
  return payload.result;
}

export async function accountExists(accountId: string): Promise<boolean | null> {
  try {
    await nearRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("does not exist") || message.includes("unknown account")) return false;
    return null;
  }
}

export async function viewContract<T>(contractId: string, methodName: string, args: object): Promise<T> {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const result = await nearRpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
  });
  return JSON.parse(Buffer.from(result.result).toString()) as T;
}
