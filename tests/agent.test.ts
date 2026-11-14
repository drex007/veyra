import { describe, expect, it } from "vitest";
import { evaluatePayments, isValidNearAccountId } from "@/lib/agent";
import { buildDeterministicFindings } from "@/lib/openai-agent";
import { runPaymentReadinessAgent } from "@/lib/treasury-agent";
import type { CsvPayment } from "@/lib/types";

function payment(recipient: string, amount: string, id = recipient): CsvPayment {
  return {
    id,
    recipient,
    amount,
    token: "NEAR",
    memo: "Test payment",
    status: "pending",
    valid: false,
    exists: null,
    riskScore: 0,
    issues: [],
  };
}

const policy = {
  maxPerRecipient: 10,
  requireExistingAccount: true,
  blockDuplicates: true,
  useOpenAI: false,
};

describe("NEAR account validation", () => {
  it("accepts named and sub accounts", () => {
    expect(isValidNearAccountId("alice.testnet")).toBe(true);
    expect(isValidNearAccountId("payroll.team.testnet")).toBe(true);
  });

  it("rejects spaces and repeated separators", () => {
    expect(isValidNearAccountId("invalid wallet")).toBe(false);
    expect(isValidNearAccountId("alice..testnet")).toBe(false);
  });
});

describe("agent payment policy", () => {
  it("accepts a valid existing recipient", () => {
    const result = evaluatePayments([payment("alice.testnet", "1.25")], policy, {
      "alice.testnet": true,
    });
    expect(result.accepted).toBe(1);
    expect(result.totalAccepted).toBe(1.25);
  });

  it("blocks duplicates, invalid amounts and missing accounts", () => {
    const result = evaluatePayments(
      [
        payment("alice.testnet", "1", "1"),
        payment("alice.testnet", "1", "2"),
        payment("ghost.testnet", "-2", "3"),
      ],
      policy,
      { "alice.testnet": true, "ghost.testnet": false },
    );
    expect(result.rejected).toBe(3);
    expect(result.payments[0].issues).toContain("Duplicate recipient");
    expect(result.payments[2].issues).toContain("Invalid payment amount");
  });

  it("flags a statistically unusual amount without silently changing it", () => {
    const result = evaluatePayments(
      [
        payment("a.testnet", "10", "1"),
        payment("b.testnet", "10", "2"),
        payment("c.testnet", "12", "3"),
        payment("d.testnet", "100", "4"),
      ],
      { ...policy, maxPerRecipient: 1_000, requireExistingAccount: false },
    );
    expect(result.payments[3].issues[0]).toMatch(/Unusual amount/);
    expect(result.payments[3].valid).toBe(true);
  });

  it("turns deterministic issues into evidence-backed analyst findings", () => {
    const result = evaluatePayments(
      [payment("alice.testnet", "1", "1"), payment("alice.testnet", "1", "2")],
      policy,
      { "alice.testnet": true },
    );
    const findings = buildDeterministicFindings(result.payments);
    expect(findings[0]).toMatchObject({
      code: "duplicate-recipients",
      severity: "critical",
      affectedPaymentIds: ["1", "2"],
    });
  });

  it("runs an auditable readiness loop and keeps policy failures held", async () => {
    const evaluated = evaluatePayments(
      [payment("alice.testnet", "1", "1"), payment("invalid wallet", "1", "2")],
      { ...policy, requireExistingAccount: false },
      { "alice.testnet": true, "invalid wallet": false },
    );
    const run = await runPaymentReadinessAgent(evaluated.payments, false);
    expect(run.source).toBe("policy-engine");
    expect(run.paymentDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentId: "1", disposition: "ready" }),
      expect.objectContaining({ paymentId: "2", disposition: "held" }),
    ]));
    expect(run.activity.map((item) => item.tool)).toEqual(expect.arrayContaining([
      "get_batch_details",
      "validate_recipients",
      "finalize_readiness",
    ]));
  });
});
