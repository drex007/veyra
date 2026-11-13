import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { AgentAnalysis, CsvPayment, IntelligenceFinding } from "@/lib/types";

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

const analysisSchema = z.object({
  summary: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]),
  reviewRequired: z.boolean(),
  flaggedRecipients: z.array(z.string()),
  recommendations: z.array(z.string()),
  findings: z.array(findingSchema),
});

interface FindingTemplate {
  code: string;
  category: IntelligenceFinding["category"];
  severity: IntelligenceFinding["severity"];
  title: string;
  matches: (issue: string) => boolean;
  evidence: (payments: CsvPayment[]) => string;
  explanation: string;
  suggestedAction: string;
}

const findingTemplates: FindingTemplate[] = [
  {
    code: "duplicate-recipients",
    category: "duplicate",
    severity: "critical",
    title: "Duplicate payments detected",
    matches: (issue) => issue === "Duplicate recipient",
    evidence: (payments) => `${payments.length} rows repeat a recipient and asset combination.`,
    explanation: "Repeated recipients can result in an unintended second payment if they are funded without confirmation.",
    suggestedAction: "Confirm whether each repeated recipient is intentional before funding escrow.",
  },
  {
    code: "invalid-accounts",
    category: "account",
    severity: "critical",
    title: "Invalid wallet addresses",
    matches: (issue) => issue === "Invalid NEAR account format",
    evidence: (payments) => `${payments.length} rows fail deterministic NEAR account ID validation.`,
    explanation: "These rows cannot be safely submitted as NEAR recipients.",
    suggestedAction: "Remove the invalid rows or replace them only after confirming the correct account with the recipient.",
  },
  {
    code: "missing-accounts",
    category: "account",
    severity: "warning",
    title: "Accounts not found on testnet",
    matches: (issue) => issue === "Account was not found on testnet",
    evidence: (payments) => `${payments.length} recipient accounts were not found by the configured NEAR RPC endpoint.`,
    explanation: "A missing account may be mistyped, on another network, or not created yet.",
    suggestedAction: "Confirm the network and account spelling with each recipient before approval.",
  },
  {
    code: "invalid-amounts",
    category: "amount",
    severity: "critical",
    title: "Invalid payment amounts",
    matches: (issue) => issue === "Invalid payment amount",
    evidence: (payments) => `${payments.length} rows contain a non-positive, malformed, or unsupported amount.`,
    explanation: "Invalid amounts cannot be represented safely in the selected asset's atomic units.",
    suggestedAction: "Correct the source spreadsheet and run validation again.",
  },
  {
    code: "unusual-amounts",
    category: "amount",
    severity: "warning",
    title: "Unusual payment amounts",
    matches: (issue) => issue.startsWith("Unusual amount:"),
    evidence: (payments) => `${payments.length} rows are at least three times their asset's batch median.`,
    explanation: "Large deviations can be legitimate, but they deserve a second-person review before money moves.",
    suggestedAction: "Compare the flagged amounts with the invoice, payroll register, or approval record.",
  },
  {
    code: "policy-limits",
    category: "policy",
    severity: "critical",
    title: "Payment policy limits exceeded",
    matches: (issue) => issue.startsWith("Exceeds "),
    evidence: (payments) => `${payments.length} rows exceed the configured per-recipient limit.`,
    explanation: "The requested values are outside the operator-approved payment policy.",
    suggestedAction: "Verify the source authorization or change the policy explicitly before re-running review.",
  },
];

export function buildDeterministicFindings(payments: CsvPayment[]): IntelligenceFinding[] {
  return findingTemplates.flatMap((template) => {
    const affected = payments.filter((payment) => payment.issues.some(template.matches));
    if (!affected.length) return [];
    return [{
      code: template.code,
      category: template.category,
      severity: template.severity,
      title: template.title,
      affectedPaymentIds: affected.map((payment) => payment.id),
      evidence: template.evidence(affected),
      explanation: template.explanation,
      suggestedAction: template.suggestedAction,
    }];
  });
}

function deterministicRiskLevel(payments: CsvPayment[], findings: IntelligenceFinding[]): AgentAnalysis["riskLevel"] {
  if (payments.some((payment) => !payment.valid) || findings.some((finding) => finding.severity === "critical")) return "high";
  if (findings.length || payments.some((payment) => payment.riskScore > 0)) return "medium";
  return "low";
}

function policyFallback(payments: CsvPayment[], reason?: string): AgentAnalysis {
  const findings = buildDeterministicFindings(payments);
  const flagged = payments.filter((payment) => payment.issues.length > 0);
  const recommendations = findings.length
    ? findings.map((finding) => finding.suggestedAction)
    : ["Confirm the approved totals and fund only the amount shown in Veyra."];
  return {
    enabled: false,
    source: "policy-engine",
    model: "deterministic-policy-v2",
    summary: reason ?? (flagged.length
      ? `${flagged.length} of ${payments.length} payment rows require review before funding.`
      : `All ${payments.length} payment rows passed the configured deterministic checks.`),
    riskLevel: deterministicRiskLevel(payments, findings),
    reviewRequired: flagged.length > 0,
    reviewedRows: payments.length,
    flaggedRows: flagged.length,
    flaggedRecipients: [...new Set(flagged.map((payment) => payment.recipient))],
    recommendations,
    findings,
  };
}

function riskRank(level: AgentAnalysis["riskLevel"]): number {
  return { low: 0, medium: 1, high: 2 }[level];
}

export async function analyzePaymentBatch(
  payments: CsvPayment[],
  enabled: boolean,
): Promise<AgentAnalysis> {
  if (!enabled) return policyFallback(payments, "OpenAI analysis was disabled; deterministic payment controls were applied.");
  if (!process.env.OPENAI_API_KEY) {
    return policyFallback(payments, "OpenAI is not configured; deterministic payment controls were applied.");
  }

  const deterministicFindings = buildDeterministicFindings(payments);
  const baselineRisk = deterministicRiskLevel(payments, deterministicFindings);
  const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const response = await client.responses.parse({
      model,
      store: false,
      instructions: [
        "You are Veyra's payment operations risk analyst for NEAR disbursement batches.",
        "Explain verified deterministic findings in plain language for a finance operator.",
        "You may add a review-only semantic finding when a memo or amount pattern is genuinely unusual, but never label an address as fraudulent.",
        "Never approve a row rejected by deterministic policy, never change a recipient or amount, and never claim that funds moved.",
        "Preserve deterministic finding codes when discussing those findings and recommend explicit human review for financially significant changes.",
      ].join(" "),
      input: JSON.stringify({
        batch: {
          rowCount: payments.length,
          approvedRows: payments.filter((payment) => payment.valid).length,
          heldRows: payments.filter((payment) => !payment.valid).length,
        },
        deterministicFindings,
        payments: payments.map(({ id, recipient, amount, token, memo, valid, issues, riskScore }) => ({
          id,
          recipient,
          amount,
          token: token ?? "NEAR",
          memo,
          deterministicDecision: valid ? "approved" : "held",
          issues,
          riskScore,
        })),
      }),
      text: { format: zodTextFormat(analysisSchema, "veyra_payment_risk") },
    });
    const parsed = response.output_parsed;
    if (!parsed) return policyFallback(payments, "The OpenAI model returned no structured analysis.");

    const paymentIds = new Set(payments.map((payment) => payment.id));
    const groundedModelFindings = parsed.findings
      .map((finding) => ({
        ...finding,
        affectedPaymentIds: finding.affectedPaymentIds.filter((id) => paymentIds.has(id)),
      }))
      .filter((finding) => finding.affectedPaymentIds.length > 0);
    const modelByCode = new Map(groundedModelFindings.map((finding) => [finding.code, finding]));
    const findings = [
      ...deterministicFindings.map((finding) => {
        const modelFinding = modelByCode.get(finding.code);
        return modelFinding ? { ...modelFinding, evidence: finding.evidence, affectedPaymentIds: finding.affectedPaymentIds } : finding;
      }),
      ...groundedModelFindings.filter((finding) => !deterministicFindings.some((item) => item.code === finding.code)),
    ];
    const flaggedIds = new Set([
      ...payments.filter((payment) => payment.issues.length > 0).map((payment) => payment.id),
      ...findings.flatMap((finding) => finding.affectedPaymentIds),
    ]);
    const modelRisk = riskRank(parsed.riskLevel) >= riskRank(baselineRisk) ? parsed.riskLevel : baselineRisk;
    const flaggedRecipients = [...new Set([
      ...parsed.flaggedRecipients,
      ...payments.filter((payment) => flaggedIds.has(payment.id)).map((payment) => payment.recipient),
    ])];

    return {
      enabled: true,
      source: "openai",
      model,
      summary: parsed.summary,
      riskLevel: modelRisk,
      reviewRequired: parsed.reviewRequired || flaggedIds.size > 0,
      reviewedRows: payments.length,
      flaggedRows: flaggedIds.size,
      flaggedRecipients,
      recommendations: parsed.recommendations,
      findings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenAI error";
    console.error("Veyra OpenAI analysis failed:", message);
    return policyFallback(payments, "OpenAI analysis was unavailable; deterministic payment controls were applied.");
  }
}
