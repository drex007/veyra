import { describe, expect, it } from "vitest";
import { parsePaymentCsv, parsePaymentRows } from "@/lib/csv";

describe("payment file ingestion", () => {
  it("normalizes CSV headers and values", () => {
    const payments = parsePaymentCsv("Wallet,Amount,Memo\nalice.testnet,1.25,Design work");
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      recipient: "alice.testnet",
      amount: "1.25",
      token: "NEAR",
      memo: "Design work",
    });
  });

  it("supports USDC and USDt aliases while defaulting an empty token to NEAR", () => {
    const payments = parsePaymentCsv("wallet,amount,token\na.testnet,5,USDC\nb.testnet,6,USDt\nc.testnet,7,");
    expect(payments.map((payment) => payment.token)).toEqual(["USDC", "USDT", "NEAR"]);
  });

  it("rejects an unknown token instead of silently paying NEAR", () => {
    expect(() => parsePaymentCsv("wallet,amount,token\na.testnet,5,DAI")).toThrow("Unsupported payment token");
  });

  it("normalizes rows extracted from an Excel workbook", () => {
    const payments = parsePaymentRows([
      ["wallet", "amount", "memo"],
      ["bob.testnet", 2.5, "Engineering milestone"],
      ["carol.testnet", 0.75, "Operations"],
    ]);
    expect(payments.map(({ recipient, amount }) => ({ recipient, amount }))).toEqual([
      { recipient: "bob.testnet", amount: "2.5" },
      { recipient: "carol.testnet", amount: "0.75" },
    ]);
  });

  it("accepts a 300-recipient run so it can be split into contract-sized batches", () => {
    const csv = ["wallet,amount", ...Array.from({ length: 300 }, (_, index) => `recipient-${index}.testnet,1`)].join("\n");
    expect(parsePaymentCsv(csv)).toHaveLength(300);
  });

  it("rejects runs above the application safety limit", () => {
    const csv = ["wallet,amount", ...Array.from({ length: 1_001 }, (_, index) => `recipient-${index}.testnet,1`)].join("\n");
    expect(() => parsePaymentCsv(csv)).toThrow("maximum of 1,000");
  });
});
