import { readSheet } from "read-excel-file/browser";
import { parsePaymentRows } from "@/lib/csv";
import type { CsvPayment } from "@/lib/types";

export async function parsePaymentExcel(file: File): Promise<CsvPayment[]> {
  const rows = await readSheet(file);
  return parsePaymentRows(rows as unknown[][]);
}
