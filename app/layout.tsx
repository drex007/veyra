import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";
import { WalletProvider } from "@/components/wallet-provider";

export const metadata: Metadata = {
  title: "Veyra — Payments and treasury operations",
  description: "Review, fund, settle, and reconcile business payments on NEAR.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
