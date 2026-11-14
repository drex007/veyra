import { describe, expect, it } from "vitest";
import { investigatePaymentBatch } from "@/lib/payment-investigation";
import type { VeyraBatch } from "@/lib/types";

describe("payment failure investigation", () => {
  it("distinguishes policy holds from failed blockchain transfers", async () => {
    const batch: VeyraBatch = {
      id: "demo-1",
      name: "Demo payroll",
      owner: "demo.veyra.testnet",
      createdAt: new Date(0).toISOString(),
      status: "complete",
      total: 1,
      mode: "demo",
      payments: [
        {
          id: "row-1",
          recipient: "invalid wallet",
          amount: "2",
          token: "USDT",
          memo: "Contractor payment",
          status: "failed",
          valid: false,
          exists: false,
          riskScore: 100,
          issues: ["Invalid NEAR account format"],
        },
      ],
    };

    const result = await investigatePaymentBatch(batch, "Why did this fail?");
    expect(result.answer).toContain("held by payment policy before funding");
    expect(result.recoverableTotals).toEqual([]);
    expect(result.findings[0]).toMatchObject({ code: "policy-held-rows" });
    expect(result.activity.map((item) => item.phase)).toEqual(expect.arrayContaining(["observe", "reason", "verify"]));
    expect(result.recoveryActions).toEqual([]);
  });

  it("blocks retry preparation when a failed transfer has no conclusive chain evidence", async () => {
    const batch: VeyraBatch = {
      id: "demo-2",
      name: "Interrupted payroll",
      owner: "demo.veyra.testnet",
      createdAt: new Date(0).toISOString(),
      status: "processing",
      total: 1,
      mode: "demo",
      payments: [{
        id: "row-1",
        recipient: "alice.testnet",
        amount: "1",
        token: "NEAR",
        memo: "Payroll",
        status: "failed",
        valid: true,
        exists: true,
        riskScore: 0,
        issues: [],
      }],
    };
    const result = await investigatePaymentBatch(batch, "Can this be retried?");
    expect(result.recoveryActions[0]).toMatchObject({
      type: "prepare-retry",
      status: "blocked",
      requiresApproval: true,
    });
    expect(result.recoverableTotals).toEqual([]);
  });
});
