import { WalletProvider } from "@/components/wallet-provider";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WalletProvider>{children}</WalletProvider>;
}
