import OpenAI from "openai";
import type { ResponseInput, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { paymentTotals } from "@/lib/amounts";
import { viewContract } from "@/lib/near-rpc";
import type {
  AgentActivity,
  AgentPaymentDecision,
  CsvPayment,
  PaymentToken,
  TreasuryAgentRun,
} from "@/lib/types";

type RegistrationState = "registered" | "missing" | "unknown" | "not-required";

interface ToolContext {
  payments: CsvPayment[];
  activity: AgentActivity[];
  registrations: Map<string, RegistrationState>;
  requestedHolds: Map<string, string>;
  observed: Set<string>;
}

interface ToolCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

const noArguments = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

const tools: Tool[] = [
  {
    type: "function",
    name: "get_batch_details",
    description: "Observe immutable payment rows, assets, totals, and current deterministic decisions.",
    strict: true,
    parameters: noArguments,
  },
  {
    type: "function",
    name: "validate_recipients",
    description: "Inspect recipient format, live account checks, duplicates, amounts, and policy findings.",
    strict: true,
    parameters: noArguments,
  },
  {
    type: "function",
    name: "check_token_registration",
    description: "Check NEP-141 storage registration for token recipients when a token contract is configured.",
    strict: true,
    parameters: noArguments,
  },
  {
    type: "function",
    name: "assess_payment_risk",
    description: "Inspect deterministic risk scores and warning signals without alleging fraud.",
    strict: true,
    parameters: noArguments,
  },
  {
    type: "function",
    name: "pause_payments",
    description: "Request a pre-funding hold for rows supported by a verified policy, risk, account, or token-registration signal. The backend rejects unsupported holds.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        payment_ids: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["payment_ids", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "finalize_readiness",
    description: "Finish the run after observing batch details and validation evidence. The backend, not the model, computes final dispositions.",
    strict: true,
    parameters: {
      type: "object",
      properties: { rationale: { type: "string" } },
      required: ["rationale"],
      additionalProperties: false,
    },
  },
];

function addActivity(
  context: ToolContext,
  phase: AgentActivity["phase"],
  tool: string,
  status: AgentActivity["status"],
  message: string,
  detail?: string,
) {
  context.activity.push({
    id: `${tool}-${context.activity.length + 1}`,
    phase,
    tool,
    status,
    message,
    detail,
    createdAt: new Date().toISOString(),
  });
}

function tokenContractId(token: PaymentToken): string | undefined {
  if (token === "USDC") return process.env.NEXT_PUBLIC_USDC_TOKEN_ID;
  if (token === "USDT") return process.env.NEXT_PUBLIC_USDT_TOKEN_ID;
  return undefined;
}

async function loadTokenRegistrations(context: ToolContext) {
  const tokenPayments = context.payments.filter((payment) => payment.token !== "NEAR" && payment.valid);
  await Promise.all(tokenPayments.map(async (payment) => {
    const key = `${payment.token}:${payment.recipient}`;
    if (context.registrations.has(key)) return;
    const contractId = tokenContractId(payment.token);
    if (!contractId) {
      context.registrations.set(key, "unknown");
      return;
    }
    try {
      const balance = await viewContract<null | { total: string }>(contractId, "storage_balance_of", {
        account_id: payment.recipient,
      });
      context.registrations.set(key, balance ? "registered" : "missing");
    } catch {
      context.registrations.set(key, "unknown");
    }
  }));
}

function registrationFor(context: ToolContext, payment: CsvPayment): RegistrationState {
  if (payment.token === "NEAR") return "not-required";
  return context.registrations.get(`${payment.token}:${payment.recipient}`) ?? "unknown";
}

async function executeTool(name: string, rawArguments: string, context: ToolContext): Promise<Record<string, unknown>> {
  const args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  if (name === "get_batch_details") {
    context.observed.add(name);
    const totals = paymentTotals(context.payments.filter((payment) => payment.valid));
    addActivity(context, "observe", name, "completed", `Loaded ${context.payments.length} immutable payment rows.`, `${totals.map(({ token, amount }) => `${amount} ${token}`).join(", ") || "No approved value"}.`);
    return { rows: context.payments.length, totals, payments: context.payments.map(({ id, recipient, amount, token, valid }) => ({ id, recipient, amount, token, valid })) };
  }
  if (name === "validate_recipients") {
    context.observed.add(name);
    const flagged = context.payments.filter((payment) => payment.issues.length > 0);
    addActivity(context, "act", name, "completed", `Validated recipients and policy findings; ${flagged.length} row${flagged.length === 1 ? "" : "s"} carry evidence.`, flagged.map((payment) => `${payment.id}: ${payment.issues.join("; ")}`).join(" | ") || "No deterministic issues.");
    return { payments: context.payments.map(({ id, recipient, exists, valid, riskScore, issues }) => ({ id, recipient, exists, valid, riskScore, issues })) };
  }
  if (name === "check_token_registration") {
    context.observed.add(name);
    await loadTokenRegistrations(context);
    const checks = context.payments.filter((payment) => payment.token !== "NEAR" && payment.valid).map((payment) => ({
      paymentId: payment.id,
      recipient: payment.recipient,
      token: payment.token,
      state: registrationFor(context, payment),
    }));
    const missing = checks.filter((item) => item.state === "missing").length;
    const unknown = checks.filter((item) => item.state === "unknown").length;
    addActivity(context, "act", name, checks.length ? "completed" : "skipped", checks.length ? `Checked token storage readiness: ${missing} missing, ${unknown} unverified.` : "No token recipient requires a storage check.", checks.length ? JSON.stringify(checks) : undefined);
    return { checks };
  }
  if (name === "assess_payment_risk") {
    context.observed.add(name);
    const signals = context.payments.filter((payment) => payment.riskScore > 0).map(({ id, riskScore, issues }) => ({ paymentId: id, riskScore, issues }));
    addActivity(context, "reason", name, "completed", `Assessed risk signals for ${context.payments.length} rows; ${signals.length} need attention.`, signals.length ? JSON.stringify(signals) : "No deterministic risk signals.");
    return { signals };
  }
  if (name === "pause_payments") {
    const paymentIds = Array.isArray(args.payment_ids) ? args.payment_ids.filter((value): value is string => typeof value === "string") : [];
    const reason = typeof args.reason === "string" ? args.reason.trim() : "Agent-requested review";
    await loadTokenRegistrations(context);
    const accepted: string[] = [];
    const denied: string[] = [];
    paymentIds.forEach((id) => {
      const payment = context.payments.find((item) => item.id === id);
      const supported = payment && (
        !payment.valid ||
        payment.riskScore > 0 ||
        payment.issues.length > 0 ||
        payment.exists !== true ||
        registrationFor(context, payment) === "missing"
      );
      if (payment && supported) {
        context.requestedHolds.set(id, reason);
        accepted.push(id);
      } else {
        denied.push(id);
      }
    });
    addActivity(context, "act", name, denied.length ? "blocked" : "completed", accepted.length ? `Placed ${accepted.length} evidence-backed row${accepted.length === 1 ? "" : "s"} on a pre-funding hold.` : "No requested hold had sufficient evidence.", denied.length ? `Unsupported hold requests rejected: ${denied.join(", ")}.` : reason);
    return { accepted, denied, reason };
  }
  if (name === "finalize_readiness") {
    const hasDetails = context.observed.has("get_batch_details");
    const hasEvidence = ["validate_recipients", "check_token_registration", "assess_payment_risk"].some((tool) => context.observed.has(tool));
    if (!hasDetails || !hasEvidence) {
      addActivity(context, "verify", name, "blocked", "Finalization was blocked until batch details and validation evidence are observed.");
      return { finalized: false, required: [!hasDetails ? "get_batch_details" : null, !hasEvidence ? "validation tool" : null].filter(Boolean) };
    }
    addActivity(context, "verify", name, "completed", "Verified final dispositions against backend policy and tool evidence.", typeof args.rationale === "string" ? args.rationale : undefined);
    return { finalized: true };
  }
  throw new Error(`Unknown Treasury Agent tool: ${name}`);
}

function buildDecisions(context: ToolContext): AgentPaymentDecision[] {
  return context.payments.map((payment) => {
    const registration = registrationFor(context, payment);
    if (!payment.valid) return { paymentId: payment.id, disposition: "held", reason: payment.issues[0] ?? "Deterministic policy hold" };
    if (registration === "missing") return { paymentId: payment.id, disposition: "held", reason: `${payment.token} storage registration is missing` };
    const requestedReason = context.requestedHolds.get(payment.id);
    if (requestedReason) return { paymentId: payment.id, disposition: "held", reason: requestedReason };
    if (payment.issues.length > 0 || payment.exists === null || registration === "unknown") {
      return { paymentId: payment.id, disposition: "review", reason: payment.issues[0] ?? (registration === "unknown" ? `${payment.token} storage registration could not be verified` : "Live account state could not be verified") };
    }
    return { paymentId: payment.id, disposition: "ready", reason: "Policy and readiness checks passed" };
  });
}

async function runDeterministicLoop(context: ToolContext) {
  await executeTool("get_batch_details", "{}", context);
  await executeTool("validate_recipients", "{}", context);
  if (context.payments.some((payment) => payment.token !== "NEAR" && payment.valid)) {
    await executeTool("check_token_registration", "{}", context);
  }
  await executeTool("assess_payment_risk", "{}", context);
  const riskyIds = context.payments.filter((payment) => payment.valid && payment.riskScore >= 75).map((payment) => payment.id);
  if (riskyIds.length) await executeTool("pause_payments", JSON.stringify({ payment_ids: riskyIds, reason: "High deterministic risk score" }), context);
  await executeTool("finalize_readiness", JSON.stringify({ rationale: "Deterministic fallback completed all applicable readiness checks." }), context);
}

async function runOpenAILoop(context: ToolContext): Promise<{ completed: boolean; model: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
  if (!process.env.OPENAI_API_KEY) return { completed: false, model: "deterministic-treasury-agent-v1" };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input: ResponseInput = [{
    role: "user",
    content: JSON.stringify({
      objective: "Classify every payment as ready, review, or held before escrow funding.",
      rowCount: context.payments.length,
      assets: [...new Set(context.payments.map((payment) => payment.token))],
    }),
  }];
  try {
    for (let turn = 0; turn < 8; turn += 1) {
      const response = await client.responses.create({
        model,
        store: false,
        instructions: [
          "You are Veyra's bounded Treasury Readiness Agent.",
          "Use tools to investigate the batch; do not rely on the prompt metadata alone.",
          "You must call get_batch_details and at least one evidence tool before finalize_readiness.",
          "Check token registration when token recipients exist. Use pause_payments only for evidence-backed concerns.",
          "Never change recipients or amounts, approve a rejected row, claim fraud, move funds, or request execution.",
          "Finish by calling finalize_readiness. Backend policy is authoritative.",
        ].join(" "),
        input,
        tools,
        tool_choice: turn === 0 ? "required" : "auto",
        parallel_tool_calls: false,
      });
      input.push(...response.output as ResponseInputItem[]);
      const calls = response.output.filter((item): item is ToolCall => item.type === "function_call");
      if (!calls.length) break;
      for (const call of calls) {
        const output = await executeTool(call.name, call.arguments, context);
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      }
      const finalized = context.activity.some((item) => item.tool === "finalize_readiness" && item.status === "completed");
      if (finalized) return { completed: true, model };
    }
    return { completed: false, model };
  } catch (error) {
    console.error("Veyra Treasury Agent failed:", error instanceof Error ? error.message : error);
    return { completed: false, model };
  }
}

export async function runPaymentReadinessAgent(payments: CsvPayment[], useOpenAI: boolean): Promise<TreasuryAgentRun> {
  const context: ToolContext = {
    payments,
    activity: [],
    registrations: new Map(),
    requestedHolds: new Map(),
    observed: new Set(),
  };
  const openai = useOpenAI ? await runOpenAILoop(context) : { completed: false, model: "deterministic-treasury-agent-v1" };
  if (!openai.completed) {
    context.activity.length = 0;
    context.registrations.clear();
    context.requestedHolds.clear();
    context.observed.clear();
    await runDeterministicLoop(context);
  }
  const paymentDecisions = buildDecisions(context);
  const ready = paymentDecisions.filter((item) => item.disposition === "ready").length;
  const review = paymentDecisions.filter((item) => item.disposition === "review").length;
  const held = paymentDecisions.filter((item) => item.disposition === "held").length;
  return {
    id: `readiness-${Date.now()}`,
    objective: "payment-readiness",
    source: openai.completed ? "openai" : "policy-engine",
    model: openai.completed ? openai.model : "deterministic-treasury-agent-v1",
    decision: ready === 0 ? "blocked" : review > 0 || held > 0 ? "review" : "ready",
    summary: `${ready} ready, ${review} require review, and ${held} held before funding.`,
    activity: context.activity,
    paymentDecisions,
    generatedAt: new Date().toISOString(),
  };
}
