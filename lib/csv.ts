import Papa from "papaparse";
import type { CsvPayment, PaymentToken } from "@/lib/types";

export interface CsvRow {
  wallet?: string;
  recipient?: string;
  account?: string;
  amount?: string | number;
  token?: string;
  currency?: string;
  asset?: string;
  memo?: string;
  description?: string;
}

export function normalizePaymentToken(value: unknown): PaymentToken {
  const token = String(value ?? "").trim().toUpperCase();
  if (!token || token === "NEAR") return "NEAR";
  if (token === "USDC") return "USDC";
  if (token === "USDT" || token === "USDT.E") return "USDT";
  throw new Error(`Unsupported payment token "${token}". Use NEAR, USDC or USDT.`);
}

function rowsToPayments(rows: CsvRow[]): CsvPayment[] {
  if (rows.length === 0) {
    throw new Error("The payment file does not contain any payment rows.");
  }
  if (rows.length > 200) {
    throw new Error("The MVP supports a maximum of 200 recipients per batch.");
  }
  return rows.map((row, index) => ({
    id: `payment-${index + 1}`,
    recipient: String(row.wallet ?? row.recipient ?? row.account ?? "").trim().toLowerCase(),
    amount: String(row.amount ?? "").trim(),
    token: normalizePaymentToken(row.token ?? row.currency ?? row.asset),
    memo: String(row.memo ?? row.description ?? "").trim(),
    status: "pending",
    valid: false,
    exists: null,
    riskScore: 0,
    issues: [],
  }));
}

export function parsePaymentCsv(content: string): CsvPayment[] {
  const parsed = Papa.parse<CsvRow>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  if (parsed.errors.length) {
    throw new Error(parsed.errors[0]?.message ?? "The CSV could not be parsed.");
  }

  return rowsToPayments(parsed.data);
}

export function parsePaymentRows(rows: unknown[][]): CsvPayment[] {
  if (rows.length < 2) throw new Error("The Excel sheet needs a header row and at least one payment.");
  const headers = rows[0].map((value) => String(value ?? "").trim().toLowerCase());
  const records = rows.slice(1).filter((row) => row.some((value) => value !== null && value !== "")).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => { if (header) record[header] = row[index]; });
    return record as CsvRow;
  });
  return rowsToPayments(records);
}

export function paymentsToCsv(payments: CsvPayment[]): string {
  return Papa.unparse(
    payments.map((payment) => ({
      recipient: payment.recipient,
      amount: payment.amount,
      token: payment.token ?? "NEAR",
      memo: payment.memo,
      status: payment.status,
      transaction: payment.txHash ?? "",
      issues: payment.issues.join("; "),
    })),
  );
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
