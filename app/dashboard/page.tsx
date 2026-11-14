import type { Metadata } from "next";
import { VeyraApp } from "@/components/veyra-app";

export const metadata: Metadata = {
  title: "Dashboard — Veyra",
  description: "Review, fund, settle, and reconcile Veyra payment runs.",
};

export default function Dashboard() {
  return <VeyraApp />;
}
