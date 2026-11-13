import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { paymentTotals, TOKEN_DECIMALS } from "@/lib/amounts";
import { nearRpc, viewContract } from "@/lib/near-rpc";
import type {
  IntelligenceFinding,
  InvestigationEvidence,
  PaymentInvestigation,
  PaymentToken,
  TokenTotal,
  VeyraBatch,
} from "@/lib/types";

const findingSchema = z.object({
  code: z.string(),
  category: z.enum(["duplicate", "amount", "account", "policy", "execution", "reconciliation"]),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  affectedPaymentIds: z.array(z.string()),
  evidence: z.string(),
  explanation: z.string(),
  suggestedAction: z.string(),
});

const investigationSchema = z.object({
  answer: z.string(),
  summary: z.string(),
  findings: z.array(findingSchema),
  nextActions: z.array(z.string()),
});

interface OnChainBatch {
  id: string;
  token_symbol: PaymentToken;
  token_decimals: number;
  status: string;
  escrow_remaining: string;
  paid_amount: string;
  items: Array<{ recipient: string; amount: string; status: string; error?: string | null }>;
}

interface TransactionResult {
  status?: unknown;
  receipts_outcome?: Array<{ id: string; outcome?: { status?: unknown; logs?: string[] } }>;
}

function atomicToAmount(value: string, token: PaymentToken): number {
  return Number(value) / 10 ** TOKEN_DECIMALS[token];
}

function uniqueTotals(totals: TokenTotal[]): TokenTotal[] {
  const byToken = new Map<PaymentToken, number>();
  totals.forEach(({ token, amount }) => byToken.set(token, (byToken.get(token) ?? 0) + amount));
  return [...byToken].map(([token, amount]) => ({ token, amount }));
}

function buildFailureFindings(batch: VeyraBatch): IntelligenceFinding[] {
  const policyHeld = batch.payments.filter((payment) => payment.status === "failed" && !payment.valid);
  const executionFailed = batch.payments.filter((payment) => payment.status === "failed" && payment.valid);
  const unresolved = batch.payments.filter((payment) => payment.status === "pending" || payment.status === "processing");
  const findings: IntelligenceFinding[] = [];

  if (policyHeld.length) {
    findings.push({
      code: "policy-held-rows",
      category: "policy",
      severity: "warning",
      title: "Rows held before funding",
      affectedPaymentIds: policyHeld.map((payment) => payment.id),
      evidence: `${policyHeld.length} rows failed deterministic review and were excluded before escrow funding.`,
      explanation: "These are validation holds, not failed blockchain transfers, so their amounts were never sent.",
      suggestedAction: "Correct the source data and submit the rows as a new reviewed batch if payment is still required.",
    });
  }
  if (executionFailed.length) {
    findings.push({
      code: "execution-failures",
      category: "execution",
      severity: "critical",
      title: "On-chain payments require investigation",
      affectedPaymentIds: executionFailed.map((payment) => payment.id),
      evidence: `${executionFailed.length} approved rows are recorded as failed after execution began.`,
      explanation: "The transfer did not reach a confirmed successful state and its escrow accounting must be checked before retrying.",
      suggestedAction: "Verify the contract batch and transaction receipt, then retry only through a new operator-approved action.",
    });
  }
  if (unresolved.length) {
    findings.push({
      code: "unresolved-payments",
      category: "reconciliation",
      severity: "warning",
      title: "Payments still need reconciliation",
      affectedPaymentIds: unresolved.map((payment) => payment.id),
      evidence: `${unresolved.length} rows remain pending or processing in the application record.`,
      explanation: "An incomplete local status is not proof that funds were lost or transferred.",
      suggestedAction: "Refresh the on-chain batch state before taking any retry or refund action.",
    });
  }
  return findings;
}

async function collectTransactionEvidence(batch: VeyraBatch): Promise<InvestigationEvidence[]> {
  const hashes = [...new Set(batch.payments.flatMap((payment) => payment.txHash ? [payment.txHash] : []))];
  const evidence = await Promise.all(hashes.map(async (hash): Promise<InvestigationEvidence> => {
    try {
      const transaction = await nearRpc<TransactionResult>("tx", [hash, batch.owner]);
      const failures = transaction.receipts_outcome?.filter((receipt) => JSON.stringify(receipt.outcome?.status).includes("Failure")) ?? [];
      return {
        source: "transaction-receipt",
        reference: hash,
        verified: true,
        detail: failures.length
          ? `NEAR RPC returned ${failures.length} failed receipt${failures.length === 1 ? "" : "s"}: ${JSON.stringify(failures[0]?.outcome?.status).slice(0, 500)}`
          : `NEAR RPC returned the transaction with no failed receipts in the available outcome. Final status: ${JSON.stringify(transaction.status).slice(0, 240)}`,
      };
    } catch (error) {
      return {
        source: "transaction-receipt",
        reference: hash,
        verified: false,
        detail: `The receipt could not be loaded from NEAR RPC: ${error instanceof Error ? error.message : "unknown RPC error"}`,
      };
    }
  }));
  return evidence;
}

async function collectEscrowEvidence(batch: VeyraBatch): Promise<{ evidence: InvestigationEvidence[]; recoverable: TokenTotal[] }> {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  const ids = [...new Set([
    ...(batch.assets?.flatMap((asset) => asset.contractBatchId === undefined ? [] : [asset.contractBatchId]) ?? []),
    ...(batch.contractBatchId === undefined ? [] : [batch.contractBatchId]),
  ])];
  if (!contractId || batch.mode !== "contract" || !ids.length) return { evidence: [], recoverable: [] };

  const results = await Promise.all(ids.map(async (batchId) => {
    try {
      const snapshot = await viewContract<OnChainBatch | null>(contractId, "get_batch", { batch_id: batchId });
      if (!snapshot) throw new Error("Batch was not found on the configured contract");
      const amount = atomicToAmount(snapshot.escrow_remaining, snapshot.token_symbol);
      return {
        evidence: {
          source: "escrow-contract" as const,
          reference: `${contractId}#${batchId}`,
          verified: true,
          detail: `On-chain status ${snapshot.status}; ${amount} ${snapshot.token_symbol} remains in escrow and ${atomicToAmount(snapshot.paid_amount, snapshot.token_symbol)} ${snapshot.token_symbol} is recorded as paid.`,
        },
        recoverable: amount > 0 ? { token: snapshot.token_symbol, amount } : null,
      };
    } catch (error) {
      return {
        evidence: {
          source: "escrow-contract" as const,
          reference: `${contractId}#${batchId}`,
          verified: false,
          detail: `The escrow snapshot could not be verified: ${error instanceof Error ? error.message : "unknown contract read error"}`,
        },
        recoverable: null,
      };
    }
  }));
  return {
    evidence: results.map((result) => result.evidence),
    recoverable: uniqueTotals(results.flatMap((result) => result.recoverable ? [result.recoverable] : [])),
  };
}

function fallbackInvestigation(
  batch: VeyraBatch,
  question: string,
  findings: IntelligenceFinding[],
  evidence: InvestigationEvidence[],
  recoverableTotals: TokenTotal[],
  reason?: string,
): PaymentInvestigation {
  const failed = batch.payments.filter((payment) => payment.status === "failed");
  const successful = batch.payments.filter((payment) => payment.status === "success");
  const nextActions = findings.length
    ? findings.map((finding) => finding.suggestedAction)
    : ["No failed payment is recorded. Keep the exported audit report with the batch record."];
  const policyOnly = failed.length > 0 && failed.every((payment) => !payment.valid);
  const answer = policyOnly
    ? `${failed.length} rows were held by payment policy before funding. They are not failed blockchain transfers and their amounts never entered escrow.`
    : failed.length
      ? `${failed.length} payments require attention. Review the verified receipt and escrow evidence below before retrying or refunding.`
      : "No failed payments are recorded for this batch.";
  return {
    enabled: false,
    source: "policy-engine",
    model: "deterministic-investigator-v1",
    answer: question ? `${answer} Question reviewed: ${question}` : answer,
    summary: reason ?? `${successful.length} succeeded, ${failed.length} failed, and ${batch.payments.length - successful.length - failed.length} remain unresolved or cancelled.`,
    failedPayments: failed.length,
    successfulPayments: successful.length,
    recoverableTotals,
    findings,
    nextActions,
    evidence,
    generatedAt: new Date().toISOString(),
  };
}

export async function investigatePaymentBatch(batch: VeyraBatch, question: string): Promise<PaymentInvestigation> {
  const findings = buildFailureFindings(batch);
  const recordEvidence: InvestigationEvidence = {
    source: "payment-record",
    reference: batch.id,
    verified: false,
    detail: `Operator session record: ${batch.payments.filter((payment) => payment.status === "success").length} success, ${batch.payments.filter((payment) => payment.status === "failed").length} failed, ${batch.payments.filter((payment) => payment.status === "pending" || payment.status === "processing").length} unresolved.`,
  };
  const [transactionEvidence, escrow] = await Promise.all([
    collectTransactionEvidence(batch),
    collectEscrowEvidence(batch),
  ]);
  const evidence = [recordEvidence, ...escrow.evidence, ...transactionEvidence];
  const recoverableTotals = escrow.recoverable.length
    ? escrow.recoverable
    : paymentTotals(batch.payments.filter((payment) => payment.status === "failed" && payment.valid));

  if (!process.env.OPENAI_API_KEY) {
    return fallbackInvestigation(batch, question, findings, evidence, recoverableTotals, "OpenAI is not configured; the investigation uses deterministic records and read-only chain evidence.");
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const response = await client.responses.parse({
      model,
      store: false,
      instructions: [
        "You are Veyra's payment failure investigator for a finance operations team.",
        "Answer only from the supplied payment records, NEAR transaction receipts, and escrow snapshots.",
        "Clearly distinguish pre-funding policy holds from failed blockchain transfers.",
        "Never claim money is recoverable unless verified escrow evidence supports it; otherwise say recovery requires verification.",
        "Never authorize a retry, edit payment data, or claim an address is fraudulent. Recommend explicit operator review.",
      ].join(" "),
      input: JSON.stringify({
        question,
        batch: {
          id: batch.id,
          name: batch.name,
          mode: batch.mode,
          status: batch.status,
          payments: batch.payments.map(({ id, recipient, amount, token, status, valid, issues, txHash }) => ({ id, recipient, amount, token, status, valid, issues, txHash })),
        },
        deterministicFindings: findings,
        evidence,
        recoverableTotals,
      }),
      text: { format: zodTextFormat(investigationSchema, "veyra_payment_investigation") },
    });
    const parsed = response.output_parsed;
    if (!parsed) return fallbackInvestigation(batch, question, findings, evidence, recoverableTotals, "The OpenAI model returned no structured investigation.");
    const validIds = new Set(batch.payments.map((payment) => payment.id));
    const groundedFindings = parsed.findings
      .map((finding) => ({ ...finding, affectedPaymentIds: finding.affectedPaymentIds.filter((id) => validIds.has(id)) }))
      .filter((finding) => finding.affectedPaymentIds.length > 0);
    return {
      enabled: true,
      source: "openai",
      model,
      answer: parsed.answer,
      summary: parsed.summary,
      failedPayments: batch.payments.filter((payment) => payment.status === "failed").length,
      successfulPayments: batch.payments.filter((payment) => payment.status === "success").length,
      recoverableTotals,
      findings: groundedFindings.length ? groundedFindings : findings,
      nextActions: parsed.nextActions,
      evidence,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Veyra payment investigation failed:", error instanceof Error ? error.message : error);
    return fallbackInvestigation(batch, question, findings, evidence, recoverableTotals, "OpenAI was unavailable; the investigation uses deterministic records and read-only chain evidence.");
  }
}
