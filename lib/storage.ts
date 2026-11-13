import { VeyraBatch } from "@/lib/types";
import { paymentTotals } from "@/lib/amounts";

const STORAGE_KEY = "veyra.demo.batches.v1";

export function getDemoBatches(): VeyraBatch[] {
  if (typeof window === "undefined") return [];
  try {
    const batches = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as VeyraBatch[];
    return batches.map((batch) => {
      const payments = batch.payments.map((payment) => ({ ...payment, token: payment.token ?? "NEAR" as const }));
      return { ...batch, payments, totals: batch.totals ?? paymentTotals(payments) };
    });
  } catch {
    return [];
  }
}

export function saveDemoBatch(batch: VeyraBatch): VeyraBatch[] {
  const batches = [batch, ...getDemoBatches().filter((item) => item.id !== batch.id)].slice(0, 20);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  return batches;
}

export function clearDemoBatches(): void {
  localStorage.removeItem(STORAGE_KEY);
}
