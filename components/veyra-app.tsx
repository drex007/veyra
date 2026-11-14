"use client";

import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  History,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { evaluatePayments } from "@/lib/agent";
import { formatTokenTotals, parseTokenAmount, paymentTotals, sumTokenAmounts } from "@/lib/amounts";
import { downloadCsv, parsePaymentCsv, paymentsToCsv } from "@/lib/csv";
import { parsePaymentExcel } from "@/lib/excel";
import { TreasuryAutopilot } from "@/components/treasury-autopilot";
import { clearDemoBatches, getDemoBatches, saveDemoBatch } from "@/lib/storage";
import type { AgentActivity, AgentPaymentDecision, CsvPayment, PaymentInvestigation, PaymentToken, TreasuryAgentRun, ValidationPolicy, ValidationSummary, VeyraAssetBatch, VeyraBatch } from "@/lib/types";
import { useWallet, type CallMethodInput } from "@/components/wallet-provider";

type View = "overview" | "new" | "treasury" | "history";
type WizardStep = "upload" | "review" | "execute";

const defaultPolicy: ValidationPolicy = {
  maxPerRecipient: 100,
  requireExistingAccount: true,
  blockDuplicates: true,
  useOpenAI: true,
};

const demoRows = `wallet,amount,token,memo
alice.testnet,1.25,,Defaults to NEAR
bob.testnet,80,USDC,Engineering milestone
invalid wallet,2.00,USDT,This row demonstrates agent rejection
carol.testnet,110,USDT,Operations support`;

const tokenContractIds: Partial<Record<PaymentToken, string>> = {
  USDC: process.env.NEXT_PUBLIC_USDC_TOKEN_ID,
  USDT: process.env.NEXT_PUBLIC_USDT_TOKEN_ID,
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function chunkPayments(payments: CsvPayment[], size: number): CsvPayment[][] {
  const chunks: CsvPayment[][] = [];
  for (let index = 0; index < payments.length; index += size) chunks.push(payments.slice(index, index + size));
  return chunks;
}

function shortAccount(accountId: string) {
  if (accountId.length <= 24) return accountId;
  return `${accountId.slice(0, 12)}…${accountId.slice(-8)}`;
}

export function VeyraApp() {
  const wallet = useWallet();
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState("");
  const [rawPayments, setRawPayments] = useState<CsvPayment[]>([]);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [policy, setPolicy] = useState<ValidationPolicy>(defaultPolicy);
  const [validating, setValidating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<VeyraBatch | null>(null);
  const [batches, setBatches] = useState<VeyraBatch[]>([]);
  const [investigation, setInvestigation] = useState<PaymentInvestigation | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [investigationQuestion, setInvestigationQuestion] = useState("Why did these payments fail, and what should I do next?");

  useEffect(() => setBatches(getDemoBatches()), []);

  useEffect(() => {
    const owner = wallet.accountId ?? "demo.veyra.testnet";
    fetch(`/api/batches?owner=${encodeURIComponent(owner)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { configured?: boolean; batches?: VeyraBatch[] } | null) => {
        if (!payload?.configured || !payload.batches?.length) return;
        setBatches((current) => {
          const byId = new Map([...payload.batches!, ...current].map((item) => [item.id, item]));
          return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
      })
      .catch(() => undefined);
  }, [wallet.accountId]);

  const persistBatch = useCallback((nextBatch: VeyraBatch) => {
    setBatches(saveDemoBatch(nextBatch));
    void fetch("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextBatch),
    }).catch(() => undefined);
  }, []);

  const completedPayments = useMemo(
    () => batches.flatMap((item) => item.payments).filter((payment) => payment.status === "success"),
    [batches],
  );
  const totalMoved = formatTokenTotals(paymentTotals(completedPayments));
  const activeBatches = batches.filter((item) => item.status === "processing").length;

  const navigate = (next: View) => {
    setView(next);
    setMenuOpen(false);
  };

  const loadPayments = useCallback((payments: CsvPayment[], name: string) => {
    setError("");
    setRawPayments(payments);
    setFileName(name);
    setValidation(null);
    setBatch(null);
    setInvestigation(null);
  }, []);

  const loadContent = useCallback((content: string, name: string) => {
    try {
      loadPayments(parsePaymentCsv(content), name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read the payment file.");
    }
  }, [loadPayments]);

  const loadFile = async (file?: File) => {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
      setError("Choose a .csv or .xlsx file with wallet, amount, optional token and memo columns.");
      return;
    }
    try {
      if (lowerName.endsWith(".xlsx")) {
        loadPayments(await parsePaymentExcel(file), file.name);
      } else {
        loadContent(await file.text(), file.name);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read the payment file.");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void loadFile(event.dataTransfer.files[0]);
  };

  const validateBatch = async () => {
    if (!rawPayments.length) return;
    setValidating(true);
    setError("");
    try {
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payments: rawPayments, policy }),
      });
      if (!response.ok) throw new Error("Live RPC validation is unavailable.");
      const summary = (await response.json()) as ValidationSummary;
      setValidation(summary);
      setWizardStep("review");
    } catch {
      setValidation(evaluatePayments(rawPayments, policy));
      setWizardStep("review");
    } finally {
      setValidating(false);
    }
  };

  const createBatch = async () => {
    if (!validation) return;
    const accepted = validation.payments.filter((payment) => payment.valid);
    if (!accepted.length) {
      setError("No payments passed the policy checks.");
      return;
    }
    setProcessing(true);
    setError("");
    try {
      let txHash: string | undefined;
      let contractBatchId: number | undefined;
      let id = `demo-${Date.now()}`;
      let mode: VeyraBatch["mode"] = "demo";
      const groups = new Map<PaymentToken, CsvPayment[]>();
      accepted.forEach((payment) => {
        const token = payment.token ?? "NEAR";
        groups.set(token, [...(groups.get(token) ?? []), payment]);
      });
      const assignments = new Map<string, { contractBatchId?: number; contractItemIndex: number }>();
      const assets: VeyraAssetBatch[] = [];

      if (wallet.isContractMode) {
        if (!wallet.accountId) throw new Error("Connect your NEAR wallet to fund this batch.");
        const [configResponse, agentResponse] = await Promise.all([
          fetch("/api/contract/config", { cache: "no-store" }),
          fetch("/api/agent/execute", { cache: "no-store" }),
        ]);
        if (!configResponse.ok) throw new Error("The configured Veyra contract is not responding.");
        const agentStatus = await agentResponse.json() as { configured?: boolean; error?: string };
        if (!agentResponse.ok || !agentStatus.configured) throw new Error(agentStatus.error ?? "Configure the server payment agent before funding this run.");
        const config = (await configResponse.json()) as { next_batch_id: string; max_batch_size?: number; supported_tokens?: Array<{ token_id: string; symbol: string }> };
        let nextBatchId = Number(config.next_batch_id);
        const maxBatchSize = Math.max(1, config.max_batch_size ?? 200);
        const batchMemo = fileName.replace(/\.(csv|xlsx)$/i, "") || "Veyra payment batch";
        const fundingRequests: CallMethodInput[] = [];
        const fundingPlans: Array<{ token: PaymentToken; payments: CsvPayment[]; contractBatchId: number }> = [];
        for (const [token, tokenPayments] of groups) {
          for (const paymentChunk of chunkPayments(tokenPayments, maxBatchSize)) {
            const currentBatchId = nextBatchId;
            nextBatchId += 1;
            const amounts = paymentChunk.map((payment) => parseTokenAmount(payment.amount, token).toString());
            const atomicTotal = sumTokenAmounts(paymentChunk.map((payment) => payment.amount), token).toString();
            if (token === "NEAR") {
              fundingRequests.push({
                methodName: "create_batch",
                args: { recipients: paymentChunk.map((payment) => payment.recipient), amounts, memo: batchMemo },
                deposit: atomicTotal,
                gas: "100000000000000",
              });
            } else {
              const tokenId = tokenContractIds[token];
              if (!tokenId) throw new Error(`${token} payments require NEXT_PUBLIC_${token}_TOKEN_ID.`);
              const allowlisted = config.supported_tokens?.some((item) => item.token_id === tokenId && item.symbol.toUpperCase() === token);
              if (!allowlisted) throw new Error(`${token} is not allowlisted by the configured Veyra contract.`);
              fundingRequests.push({
                receiverId: tokenId,
                methodName: "ft_transfer_call",
                args: {
                  receiver_id: wallet.contractId,
                  amount: atomicTotal,
                  memo: `Fund Veyra ${token} batch`,
                  msg: JSON.stringify({ recipients: paymentChunk.map((payment) => payment.recipient), amounts, memo: batchMemo }),
                },
                deposit: "1",
                gas: "150000000000000",
              });
            }
            fundingPlans.push({ token, payments: paymentChunk, contractBatchId: currentBatchId });
          }
        }
        const fundingHashes = await wallet.callMethods(fundingRequests);
        fundingPlans.forEach((plan, planIndex) => {
          const fundingTxHash = fundingHashes[planIndex];
          txHash ??= fundingTxHash;
          contractBatchId ??= plan.contractBatchId;
          plan.payments.forEach((payment, index) => assignments.set(payment.id, { contractBatchId: plan.contractBatchId, contractItemIndex: index }));
          assets.push({
            token: plan.token,
            total: plan.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
            contractBatchId: plan.contractBatchId,
            fundingTxHash,
          });
        });
        id = `near-${contractBatchId}-${Date.now()}`;
        mode = "contract";
      } else {
        await wait(650);
        for (const [token, tokenPayments] of groups) {
          for (const paymentChunk of chunkPayments(tokenPayments, 200)) {
            paymentChunk.forEach((payment, index) => assignments.set(payment.id, { contractItemIndex: index }));
            assets.push({ token, total: paymentChunk.reduce((sum, payment) => sum + Number(payment.amount), 0) });
          }
        }
      }

      const nextBatch: VeyraBatch = {
        id,
        name: fileName.replace(/\.(csv|xlsx)$/i, "") || "Payment batch",
        owner: wallet.accountId ?? "demo.veyra.testnet",
        createdAt: new Date().toISOString(),
        status: "ready",
        payments: validation.payments.map((payment) => ({
          ...payment,
          status: payment.valid ? "pending" : "failed",
          ...assignments.get(payment.id),
        })),
        total: validation.totalAccepted,
        totals: validation.totalsAccepted ?? paymentTotals(accepted),
        assets,
        txHash,
        contractBatchId,
        mode,
        agentRuns: validation.treasuryAgent ? [validation.treasuryAgent] : [],
      };
      setBatch(nextBatch);
      persistBatch(nextBatch);
      setWizardStep("execute");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create the batch.");
    } finally {
      setProcessing(false);
    }
  };

  const runAgent = async () => {
    if (!batch) return;
    setInvestigation(null);
    setProcessing(true);
    setError("");
    let working: VeyraBatch = { ...batch, status: "processing" };
    setBatch(working);
    persistBatch(working);

    try {
      if (working.mode === "contract") {
        const assetBatches = working.assets?.filter((asset) => asset.contractBatchId !== undefined) ?? [];
        if (!assetBatches.length && working.contractBatchId !== undefined) assetBatches.push({ token: "NEAR", total: working.total, contractBatchId: working.contractBatchId });
        if (!assetBatches.length) throw new Error("Missing on-chain batch ids.");
        const batchIds = [...new Set(assetBatches.flatMap((asset) => asset.contractBatchId === undefined ? [] : [asset.contractBatchId]))];
        let payments = [...working.payments];
        let stalledRounds = 0;
        const maxRounds = Math.ceil(payments.filter((payment) => payment.valid).length / 5) + 10;
        for (let round = 0; round < maxRounds; round += 1) {
          const response = await fetch("/api/agent/execute", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ batchIds, maxItems: 5 }),
          });
          const payload = await response.json() as {
            error?: string;
            processed?: number;
            batches?: Array<{
              batchId: number;
              processedItems: Array<{ index: number; transactionHash?: string }>;
              snapshot: { items: Array<{ status: string; error?: string | null }> };
            }>;
          };
          if (!response.ok) throw new Error(payload.error ?? "The server payment agent could not continue.");
          for (const result of payload.batches ?? []) {
            const hashes = new Map(result.processedItems.map((item) => [item.index, item.transactionHash]));
            payments = payments.map((payment) => {
              if (payment.contractBatchId !== result.batchId || payment.contractItemIndex === undefined) return payment;
              const item = result.snapshot.items[payment.contractItemIndex];
              if (!item) return payment;
              const status = item.status.toLowerCase() as CsvPayment["status"];
              const nextIssue = item.error && !payment.issues.includes(item.error) ? [...payment.issues, item.error] : payment.issues;
              return { ...payment, status, issues: nextIssue, txHash: hashes.get(payment.contractItemIndex) ?? payment.txHash };
            });
          }
          const unresolved = payments.some((payment) => payment.valid && (payment.status === "pending" || payment.status === "processing"));
          working = { ...working, payments: [...payments], status: unresolved ? "processing" : "complete" };
          setBatch(working);
          persistBatch(working);
          if (!unresolved) break;
          stalledRounds = (payload.processed ?? 0) === 0 ? stalledRounds + 1 : 0;
          if (stalledRounds >= 5) break;
          await wait(500);
        }
      } else {
        const payments = [...working.payments];
        for (let index = 0; index < payments.length; index += 1) {
          if (!payments[index].valid) continue;
          payments[index] = { ...payments[index], status: "processing" };
          working = { ...working, payments: [...payments] };
          setBatch(working);
          await wait(120);
          payments[index] = { ...payments[index], status: "success", txHash: working.txHash };
          working = { ...working, payments: [...payments] };
          setBatch(working);
        }
        working = { ...working, status: "complete" };
        setBatch(working);
        persistBatch(working);
      }
    } catch (nextError) {
      working = { ...working, status: "processing" };
      setBatch(working);
      persistBatch(working);
      setError(nextError instanceof Error ? nextError.message : "Agent execution stopped.");
    } finally {
      setProcessing(false);
    }
  };

  const cancelBatch = async () => {
    if (!batch || processing || batch.status === "complete") return;
    setInvestigation(null);
    setProcessing(true);
    setError("");
    try {
      if (batch.mode === "contract") {
        const ids = batch.assets?.flatMap((asset) => asset.contractBatchId === undefined ? [] : [asset.contractBatchId])
          ?? (batch.contractBatchId === undefined ? [] : [batch.contractBatchId]);
        if (!ids.length) throw new Error("Missing on-chain batch ids.");
        await wallet.callMethods([...new Set(ids)].map((batchId) => ({ methodName: "cancel_batch", args: { batch_id: batchId } })));
      } else {
        await wait(400);
      }
      const cancelled: VeyraBatch = {
        ...batch,
        status: "cancelled",
        payments: batch.payments.map((payment) =>
          payment.status === "pending" || payment.status === "processing"
            ? { ...payment, status: "cancelled", issues: [...payment.issues, "Cancelled and refunded by owner"] }
            : payment,
        ),
      };
      setBatch(cancelled);
      persistBatch(cancelled);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not cancel the batch.");
    } finally {
      setProcessing(false);
    }
  };

  const investigateBatch = async () => {
    if (!batch || investigationQuestion.trim().length < 3) return;
    setInvestigating(true);
    setError("");
    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch, question: investigationQuestion }),
      });
      const payload = await response.json() as PaymentInvestigation | { error?: string };
      if (!response.ok) throw new Error("error" in payload ? payload.error : "Investigation failed");
      setInvestigation(payload as PaymentInvestigation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not investigate this batch.");
    } finally {
      setInvestigating(false);
    }
  };

  const resetWizard = () => {
    setWizardStep("upload");
    setRawPayments([]);
    setValidation(null);
    setBatch(null);
    setFileName("");
    setError("");
    setInvestigation(null);
  };

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand-row">
          <Link className="brand-home" href="/" aria-label="Return to Veyra home"><div className="brand-mark">V</div><div className="brand-copy"><span>Veyra</span><small>Treasury operations</small></div></Link>
          <button className="icon-button mobile-only" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <NavButton active={view === "overview"} icon={<LayoutDashboard />} label="Overview" onClick={() => navigate("overview")} />
          <NavButton active={view === "new"} icon={<Plus />} label="New payment" onClick={() => navigate("new")} />
          <NavButton active={view === "treasury"} icon={<Landmark />} label="Treasury" onClick={() => navigate("treasury")} />
          <NavButton active={view === "history"} icon={<History />} label="Batch history" onClick={() => navigate("history")} />
        </nav>

        <div className="workspace-card"><small>Workspace</small><strong>Operations team</strong><span><i /> Demo environment</span></div>

        <div className="sidebar-footer">
          <div className="network-pill"><i /> NEAR testnet</div>
          <p>Payments and treasury controls<br />for finance teams.</p>
        </div>
      </aside>

      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="topbar-status"><span className="pulse-dot" /> NEAR testnet</div>
          {wallet.accountId ? (
            <div className="wallet-connected">
              <span><WalletCards size={16} />{shortAccount(wallet.accountId)}</span>
              <button onClick={() => void wallet.disconnect()} aria-label="Disconnect wallet"><LogOut size={16} /></button>
            </div>
          ) : (
            <button className="button button-dark button-small" disabled={!wallet.ready || wallet.connecting} onClick={wallet.connect}>
              <WalletCards size={17} /> {wallet.connecting ? "Opening wallets…" : "Connect existing wallet"}
            </button>
          )}
        </header>

        <div className="content">
          {view === "overview" && (
            <Overview
              batches={batches}
              totalMoved={totalMoved}
              activeBatches={activeBatches}
              onCreate={() => { resetWizard(); navigate("new"); }}
              onHistory={() => navigate("history")}
            />
          )}
          {view === "new" && (
            <NewPayment
              step={wizardStep}
              fileName={fileName}
              payments={rawPayments}
              validation={validation}
              policy={policy}
              batch={batch}
              validating={validating}
              processing={processing}
              investigating={investigating}
              investigation={investigation}
              investigationQuestion={investigationQuestion}
              error={error}
              isContractMode={wallet.isContractMode}
              onPolicy={setPolicy}
              onFile={(event) => void loadFile(event.target.files?.[0])}
              onDrop={onDrop}
              onDemo={() => loadContent(demoRows, "demo-payroll.csv")}
              onValidate={() => void validateBatch()}
              onCreate={() => void createBatch()}
              onRun={() => void runAgent()}
              onCancel={() => void cancelBatch()}
              onInvestigationQuestion={setInvestigationQuestion}
              onInvestigate={() => void investigateBatch()}
              onBack={() => setWizardStep(wizardStep === "execute" ? "review" : "upload")}
              onReset={resetWizard}
            />
          )}
          {view === "treasury" && <TreasuryAutopilot />}
          {view === "history" && (
            <HistoryView
              batches={batches}
              onCreate={() => { resetWizard(); navigate("new"); }}
              onClear={() => { clearDemoBatches(); setBatches([]); }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>{icon}<span>{label}</span>{active && <ChevronRight size={15} />}</button>;
}

function Overview({ batches, totalMoved, activeBatches, onCreate, onHistory }: { batches: VeyraBatch[]; totalMoved: string; activeBatches: number; onCreate: () => void; onHistory: () => void }) {
  const recent = batches.slice(0, 4);
  const successRate = batches.length
    ? Math.round((batches.flatMap((batch) => batch.payments).filter((payment) => payment.status === "success").length /
        Math.max(1, batches.flatMap((batch) => batch.payments).filter((payment) => payment.valid).length)) * 100)
    : 100;

  return (
    <div className="page-stack">
      <section className="hero-row">
        <div><p className="eyebrow">Overview</p><h1>Treasury operations</h1><p className="hero-copy">Review payments, monitor settlement, and keep operating funds protected from one workspace.</p></div>
        <button className="button button-accent button-large" onClick={onCreate}><Plus size={18} /> New payment batch</button>
      </section>

      <section className="metric-grid">
        <Metric icon={<CircleDollarSign />} label="Total moved" value={totalMoved} note="Reconciled payments" tone="lime" />
        <Metric icon={<FileCheck2 />} label="Completed batches" value={String(batches.filter((batch) => batch.status === "complete").length)} note={`${batches.length} created`} tone="violet" />
        <Metric icon={<RefreshCw />} label="In progress" value={String(activeBatches)} note="Batches being settled" tone="cyan" />
        <Metric icon={<ShieldCheck />} label="Success rate" value={`${successRate}%`} note="For accepted payments" tone="amber" />
      </section>

      <section className="split-grid">
        <div className="panel recent-panel">
          <div className="panel-heading"><div><p className="eyebrow">Recent activity</p><h2>Payment batches</h2></div><button className="text-button" onClick={onHistory}>View all <ArrowRight size={15} /></button></div>
          {recent.length ? <div className="batch-list">{recent.map((batch) => <BatchRow key={batch.id} batch={batch} />)}</div> : <EmptyMini onCreate={onCreate} />}
        </div>
        <div className="panel assurance-panel">
          <p className="eyebrow">Controls</p><h2>Built for careful execution</h2>
          <div className="assurance-list">
            <Assurance icon={<ShieldCheck />} title="Policy review" copy="Limits, duplicates, and account format are checked before approval." />
            <Assurance icon={<LockKeyhole />} title="Exact funding" copy="Only the approved total enters escrow; unfinished funds remain refundable." />
            <Assurance icon={<FileSpreadsheet />} title="Clear records" copy="Every outcome stays exportable for reconciliation and audit." />
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}

function Assurance({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="assurance-item"><span>{icon}</span><div><strong>{title}</strong><p>{copy}</p></div></div>;
}

function EmptyMini({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-mini"><div><FileSpreadsheet size={23} /></div><h3>No batches yet</h3><p>Your latest payment runs will appear here.</p><button className="text-button" onClick={onCreate}>Create the first batch <ArrowRight size={15} /></button></div>;
}

interface NewPaymentProps {
  step: WizardStep;
  fileName: string;
  payments: CsvPayment[];
  validation: ValidationSummary | null;
  policy: ValidationPolicy;
  batch: VeyraBatch | null;
  validating: boolean;
  processing: boolean;
  investigating: boolean;
  investigation: PaymentInvestigation | null;
  investigationQuestion: string;
  error: string;
  isContractMode: boolean;
  onPolicy: (policy: ValidationPolicy) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDemo: () => void;
  onValidate: () => void;
  onCreate: () => void;
  onRun: () => void;
  onCancel: () => void;
  onInvestigationQuestion: (question: string) => void;
  onInvestigate: () => void;
  onBack: () => void;
  onReset: () => void;
}

function NewPayment(props: NewPaymentProps) {
  const { step, error } = props;
  return (
    <div className="page-stack narrow-stack">
      <div className="page-heading"><div><p className="eyebrow">Payments</p><h1>Create a payment batch</h1><p>Upload recipients, review the checks, then fund the approved total.</p></div><ModeBadge contractMode={props.isContractMode} /></div>
      <div className="stepper">
        <Step number="01" label="Upload" active={step === "upload"} complete={step !== "upload"} />
        <i />
        <Step number="02" label="Review" active={step === "review"} complete={step === "execute"} />
        <i />
        <Step number="03" label="Execute" active={step === "execute"} complete={props.batch?.status === "complete"} />
      </div>
      {error && <div className="alert error-alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {step === "upload" && <UploadStep {...props} />}
      {step === "review" && props.validation && <ReviewStep {...props} />}
      {step === "execute" && props.batch && <ExecuteStep {...props} />}
    </div>
  );
}

function ModeBadge({ contractMode }: { contractMode: boolean }) {
  return <div className={contractMode ? "mode-badge live" : "mode-badge"}><i />{contractMode ? "Testnet contract" : "Demo mode"}</div>;
}

function Step({ number, label, active, complete }: { number: string; label: string; active: boolean; complete?: boolean }) {
  return <div className={active ? "step active" : complete ? "step complete" : "step"}><span>{complete ? <Check size={15} /> : number}</span><strong>{label}</strong></div>;
}

function UploadStep({ fileName, payments, policy, validating, onPolicy, onFile, onDrop, onDemo, onValidate }: NewPaymentProps) {
  return (
    <div className="wizard-grid">
      <section className="panel upload-panel">
        <div className="panel-heading"><div><p className="eyebrow">Payment file</p><h2>Upload CSV or Excel</h2></div><FileSpreadsheet size={23} /></div>
        <div className={fileName ? "drop-zone has-file" : "drop-zone"} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          {fileName ? <><span className="file-icon"><FileCheck2 size={26} /></span><h3>{fileName}</h3><p>{payments.length} payment rows ready for inspection.</p><label className="text-button">Replace file<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} hidden /></label></> : <><span className="upload-icon"><UploadCloud size={26} /></span><h3>Drop a payment file here</h3><p>Choose a CSV or Excel workbook</p><label className="button button-outline">Choose CSV / Excel<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} hidden /></label><button className="text-button" onClick={onDemo}>Use demo payroll</button></>}
        </div>
        <div className="file-hint"><strong>Columns</strong><code>wallet, amount, token, memo</code><span>Blank token = NEAR</span><a href="/sample-payments.csv" download>Download template <Download size={14} /></a></div>
      </section>
      <section className="panel policy-panel">
        <div className="panel-heading"><div><p className="eyebrow">Review settings</p><h2>Payment policy</h2></div><ShieldCheck size={23} /></div>
        <label className="field-label">Maximum per recipient <span>ASSET UNITS</span><input type="number" min="0.01" step="0.01" value={policy.maxPerRecipient} onChange={(event) => onPolicy({ ...policy, maxPerRecipient: Number(event.target.value) || 0.01 })} /></label>
        <Toggle checked={policy.blockDuplicates} onChange={(checked) => onPolicy({ ...policy, blockDuplicates: checked })} title="Block duplicate recipients" copy="Reject repeated wallet addresses in one run." />
        <Toggle checked={policy.requireExistingAccount} onChange={(checked) => onPolicy({ ...policy, requireExistingAccount: checked })} title="Require live testnet account" copy="Block recipients that NEAR RPC cannot find." />
        <Toggle checked={policy.useOpenAI} onChange={(checked) => onPolicy({ ...policy, useOpenAI: checked })} title="OpenAI risk analysis" copy="Ask the configured model to identify semantic anomalies and review priorities." />
        <div className="agent-note"><ShieldCheck size={17} /><p><strong>Nothing moves during review.</strong> You decide what enters escrow after seeing every result.</p></div>
        <button className="button button-accent button-full" disabled={!payments.length || validating} onClick={onValidate}>{validating ? <><RefreshCw className="spin" size={18} /> Reviewing payments…</> : <>Review payments <ArrowRight size={18} /></>}</button>
      </section>
    </div>
  );
}

function Toggle({ checked, onChange, title, copy }: { checked: boolean; onChange: (checked: boolean) => void; title: string; copy: string }) {
  return <button className="toggle-row" onClick={() => onChange(!checked)} type="button"><span className={checked ? "toggle on" : "toggle"}><i /></span><span><strong>{title}</strong><small>{copy}</small></span></button>;
}

function ReviewStep({ validation, processing, onBack, onCreate }: NewPaymentProps) {
  if (!validation) return null;
  return (
    <section className="panel review-panel">
      <div className="review-summary">
        <div><p className="eyebrow">Review complete</p><h2>{validation.accepted} ready to fund. <em>{validation.rejected} need attention.</em></h2><p>Only rows that passed the policy, live-account, and agent-readiness checks can enter escrow.</p></div>
        <div className="approved-total"><span>Approved totals</span>{validation.totalsAccepted.map(({ token, amount }) => <strong key={token}>{amount.toFixed(2)} <small>{token}</small></strong>)}</div>
      </div>
      {validation.treasuryAgent && <TreasuryAgentPanel run={validation.treasuryAgent} />}
      {validation.aiAnalysis && <div className={`ai-analysis ${validation.aiAnalysis.riskLevel}`}><span><BrainCircuit size={20} /></span><div><div className="ai-analysis-title"><strong>{validation.aiAnalysis.source === "openai" ? "Veyra Intelligence" : "Policy-engine analysis"}</strong><small>{validation.aiAnalysis.model} · {validation.aiAnalysis.riskLevel} risk</small></div><div className="ai-analysis-counts"><span><b>{validation.aiAnalysis.reviewedRows}</b> reviewed</span><span><b>{validation.aiAnalysis.flaggedRows}</b> flagged</span><span><b>{validation.aiAnalysis.reviewRequired ? "Required" : "Clear"}</b> review</span></div><p>{validation.aiAnalysis.summary}</p>{validation.aiAnalysis.findings.length > 0 && <div className="risk-findings">{validation.aiAnalysis.findings.map((finding) => <article key={finding.code}><div><strong>{finding.title}</strong><span className={`finding-severity ${finding.severity}`}>{finding.severity}</span></div><p>{finding.explanation}</p><small>{finding.evidence}</small><small><b>Action:</b> {finding.suggestedAction}</small></article>)}</div>}{validation.aiAnalysis.recommendations.length > 0 && <ul>{validation.aiAnalysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>}</div></div>}
      <PaymentTable payments={validation.payments} decisions={validation.treasuryAgent?.paymentDecisions} />
      <div className="action-row"><button className="button button-ghost" onClick={onBack}>Back to policy</button><div><span className="escrow-note"><LockKeyhole size={15} /> One wallet interaction funds the approved run</span><button className="button button-accent" disabled={processing || !validation.accepted} onClick={onCreate}>{processing ? "Creating…" : "Approve & fund run"}<ArrowRight size={18} /></button></div></div>
    </section>
  );
}

function TreasuryAgentPanel({ run }: { run: TreasuryAgentRun }) {
  const counts = run.paymentDecisions.reduce((result, item) => ({ ...result, [item.disposition]: result[item.disposition] + 1 }), { ready: 0, review: 0, held: 0 });
  return (
    <section className={`agent-run ${run.decision}`}>
      <div className="agent-run-heading">
        <span><BrainCircuit size={19} /></span>
        <div><strong>Treasury Readiness Agent</strong><small>{run.source === "openai" ? "OpenAI tool-calling run" : "Deterministic fallback"} · {run.model}</small></div>
        <b>{run.decision}</b>
      </div>
      <p>{run.summary}</p>
      <div className="agent-decision-counts"><span><b>{counts.ready}</b> ready</span><span><b>{counts.review}</b> review</span><span><b>{counts.held}</b> held</span></div>
      <AgentActivityLog activity={run.activity} />
    </section>
  );
}

function AgentActivityLog({ activity }: { activity: AgentActivity[] }) {
  return (
    <details className="agent-activity" open>
      <summary>Agent activity · {activity.length} steps</summary>
      <div>{activity.map((item) => <article key={item.id}><span className={`activity-state ${item.status}`}><i />{item.phase}</span><div><strong>{item.tool.replaceAll("_", " ")}</strong><p>{item.message}</p>{item.detail && <small>{item.detail}</small>}</div></article>)}</div>
    </details>
  );
}

function PaymentTable({ payments, decisions = [] }: { payments: CsvPayment[]; decisions?: AgentPaymentDecision[] }) {
  const decisionsByPayment = new Map(decisions.map((decision) => [decision.paymentId, decision]));
  return <div className="table-wrap"><table><thead><tr><th>Recipient</th><th>Memo</th><th>Amount</th><th>Agent decision</th></tr></thead><tbody>{payments.map((payment) => {
    const decision = decisionsByPayment.get(payment.id);
    const disposition = decision?.disposition ?? (payment.valid ? "ready" : "held");
    const reason = decision?.reason ?? payment.issues[0] ?? "Deterministic policy hold";
    return <tr key={payment.id}><td><strong>{payment.recipient || "Missing wallet"}</strong></td><td>{payment.memo || "—"}</td><td>{payment.amount || "—"} <span className="token-label">{payment.token ?? "NEAR"}</span></td><td><div className="decision-cell">{disposition === "ready" ? <span className="status approved"><CheckCircle2 size={14} /> Ready</span> : disposition === "review" ? <span className="status review"><AlertCircle size={14} /> Review required</span> : <span className="status rejected"><XCircle size={14} /> Held</span>}{disposition !== "ready" && <small>{reason}</small>}</div></td></tr>;
  })}</tbody></table></div>;
}

function ExecuteStep({
  batch,
  processing,
  investigating,
  investigation,
  investigationQuestion,
  onRun,
  onCancel,
  onReset,
  onInvestigationQuestion,
  onInvestigate,
}: NewPaymentProps) {
  if (!batch) return null;
  const successful = batch.payments.filter((payment) => payment.status === "success");
  const failed = batch.payments.filter((payment) => payment.status === "failed");
  const finished = batch.status === "complete";
  return (
    <section className="panel execution-panel">
      <div className="execution-top">
        <div className={finished ? "execution-orb done" : "execution-orb"}>{finished ? <Check size={28} /> : <FileCheck2 size={26} />}</div>
        <div><p className="eyebrow">{finished ? "Reconciliation complete" : "Ready to settle"}</p><h2>{finished ? "Every outcome is accounted for" : "Review complete, batch funded"}</h2><p>{finished ? `${successful.length} payments settled and ${failed.length} rows were held back.` : `${formatTokenTotals(batch.totals ?? paymentTotals(batch.payments.filter((payment) => payment.valid)))} approved across ${batch.payments.filter((payment) => payment.valid).length} recipients.`}</p></div>
        <span className={`batch-status ${batch.status}`}>{batch.status}</span>
      </div>
      <div className="execution-ledger">{batch.payments.map((payment) => <div className="ledger-row" key={payment.id}><span className={`ledger-icon ${payment.status}`}>{payment.status === "success" ? <Check size={15} /> : payment.status === "failed" ? <X size={15} /> : payment.status === "processing" ? <RefreshCw className="spin" size={15} /> : <Clock3 size={15} />}</span><div><strong>{payment.recipient}</strong><small>{payment.issues[0] ?? payment.memo ?? "Ready"}</small></div><b>{payment.amount} {payment.token ?? "NEAR"}</b><span className="ledger-state">{payment.status}</span></div>)}</div>
      {!finished && batch.status !== "cancelled" ? <div className="action-row execute-actions"><div className="agent-note compact"><RefreshCw size={16} /><p>{batch.mode === "contract" ? "The configured server agent settles approved rows in small chunks. No recipient-level wallet approvals are required." : "Veyra simulates autonomous settlement and records every result."}</p></div><div className="execution-buttons"><button className="button button-ghost danger-button" disabled={processing} onClick={onCancel}>Cancel & refund</button><button className="button button-accent" disabled={processing} onClick={onRun}>{processing ? <><RefreshCw className="spin" size={17} /> Agent settling…</> : <><Play size={17} /> Start autonomous settlement</>}</button></div></div> : batch.status === "cancelled" ? <div className="report-actions"><div><strong>Batch cancelled</strong><p>Approved funds were returned to the owner and pending payments were closed.</p></div><button className="button button-outline" onClick={() => downloadCsv("veyra-cancelled.csv", paymentsToCsv(batch.payments))}><Download size={16} /> Cancellation report</button><button className="button button-dark" onClick={onReset}>New batch <Plus size={16} /></button></div> : <div className="report-actions"><div><strong>Audit files are ready</strong><p>Separate reports make accounting and exception handling straightforward.</p></div><button className="button button-outline" onClick={() => downloadCsv("veyra-success.csv", paymentsToCsv(successful))}><Download size={16} /> Success CSV</button><button className="button button-outline" onClick={() => downloadCsv("veyra-failures.csv", paymentsToCsv(failed))}><Download size={16} /> Failure CSV</button><button className="button button-dark" onClick={onReset}>New batch <Plus size={16} /></button></div>}
      {(finished || failed.length > 0) && (
        <section className="investigation-panel">
          <div className="investigation-heading"><span><MessageSquareText size={19} /></span><div><p className="eyebrow">Ask Veyra Intelligence</p><h3>Investigate payment outcomes</h3><p>Veyra checks recorded outcomes, available transaction receipts, and escrow state before explaining what happened.</p></div></div>
          <div className="investigation-prompt"><input value={investigationQuestion} maxLength={500} onChange={(event) => onInvestigationQuestion(event.target.value)} aria-label="Investigation question" /><button className="button button-dark" disabled={investigating || investigationQuestion.trim().length < 3} onClick={onInvestigate}>{investigating ? <><RefreshCw className="spin" size={16} /> Investigating…</> : <>Investigate <ArrowRight size={16} /></>}</button></div>
          {investigation && <InvestigationResult investigation={investigation} />}
        </section>
      )}
    </section>
  );
}

function InvestigationResult({ investigation }: { investigation: PaymentInvestigation }) {
  return (
    <div className="investigation-result">
      <div className="investigation-answer"><div><strong>{investigation.source === "openai" ? "AI investigation" : "Deterministic investigation"}</strong><small>{investigation.model} · {new Date(investigation.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div><p>{investigation.answer}</p></div>
      <div className="investigation-stats"><span><small>Successful</small><strong>{investigation.successfulPayments}</strong></span><span><small>Needs attention</small><strong>{investigation.failedPayments}</strong></span><span><small>Verified recoverable</small><strong>{investigation.recoverableTotals.length ? formatTokenTotals(investigation.recoverableTotals) : "Not confirmed"}</strong></span></div>
      <section className="recovery-run"><div><strong>Failure Recovery Agent</strong><small>Observe → reason → act → verify</small></div><AgentActivityLog activity={investigation.activity} /></section>
      {investigation.recoveryActions.length > 0 && <div className="recovery-actions"><strong>Constrained actions</strong>{investigation.recoveryActions.map((action) => <article key={`${action.type}-${action.paymentId}`}><span className={`recovery-status ${action.status}`}>{action.status}</span><div><strong>{action.type === "prepare-retry" ? "Retry plan" : "Execution pause"} · {action.paymentId}</strong><p>{action.reason}</p>{action.requiresApproval && <small><LockKeyhole size={12} /> Owner approval required; nothing was submitted.</small>}</div></article>)}</div>}
      {investigation.findings.length > 0 && <div className="finding-list">{investigation.findings.map((finding) => <article key={finding.code} className={`finding ${finding.severity}`}><div><strong>{finding.title}</strong><span>{finding.severity}</span></div><p>{finding.explanation}</p><small><b>Evidence:</b> {finding.evidence}</small><small><b>Next:</b> {finding.suggestedAction}</small></article>)}</div>}
      <div className="evidence-list"><strong>Evidence checked</strong>{investigation.evidence.map((item) => <div key={`${item.source}-${item.reference}`}><span className={item.verified ? "evidence-state verified" : "evidence-state"}>{item.verified ? "Verified" : "Unverified"}</span><p>{item.detail}</p><code>{item.reference}</code></div>)}</div>
    </div>
  );
}

function HistoryView({ batches, onCreate, onClear }: { batches: VeyraBatch[]; onCreate: () => void; onClear: () => void }) {
  const [selectedBatch, setSelectedBatch] = useState<VeyraBatch | null>(null);

  useEffect(() => {
    if (!selectedBatch) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedBatch(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedBatch]);

  return (
    <div className="page-stack narrow-stack">
      <div className="page-heading"><div><p className="eyebrow">Payments</p><h1>Batch history</h1><p>Every payment run, outcome, and report in one place.</p></div><button className="button button-accent" onClick={onCreate}><Plus size={17} /> New batch</button></div>
      <section className="panel history-panel">
        {batches.length ? <><div className="panel-heading"><div><p className="eyebrow">Recorded activity</p><h2>{batches.length} batch{batches.length === 1 ? "" : "es"}</h2></div><button className="text-button danger" onClick={onClear}>Clear demo history</button></div><div className="batch-list large">{batches.map((batch) => <BatchRow key={batch.id} batch={batch} onView={() => setSelectedBatch(batch)} />)}</div></> : <EmptyHistory onCreate={onCreate} />}
      </section>
      {selectedBatch && <BatchDetails batch={selectedBatch} onClose={() => setSelectedBatch(null)} />}
    </div>
  );
}

function EmptyHistory({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-history"><span><History size={27} /></span><h2>No payment history yet</h2><p>Run a demo batch or connect a testnet contract to create the first audit trail.</p><button className="button button-accent" onClick={onCreate}>Create a payment batch <ArrowRight size={17} /></button></div>;
}

function BatchRow({ batch, onView }: { batch: VeyraBatch; onView?: () => void }) {
  const successful = batch.payments.filter((payment) => payment.status === "success").length;
  return <div className="batch-row"><span className={`batch-icon ${batch.status}`}><FileSpreadsheet size={18} /></span><div className="batch-name"><strong>{batch.name}</strong><span>{new Date(batch.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span></div><div><small>Recipients</small><strong>{batch.payments.filter((payment) => payment.valid).length}</strong></div><div><small>Settled</small><strong>{successful}</strong></div><div><small>Amount</small><strong>{formatTokenTotals(batch.totals ?? paymentTotals(batch.payments.filter((payment) => payment.valid)))}</strong></div><span className="batch-row-actions"><span className={`batch-status ${batch.status}`}>{batch.status}</span>{onView && <button className="batch-view-button" onClick={onView} aria-label={`View ${batch.name}`}><Eye size={14} /> View</button>}</span></div>;
}

function BatchDetails({ batch, onClose }: { batch: VeyraBatch; onClose: () => void }) {
  const validPayments = batch.payments.filter((payment) => payment.valid);
  const successful = batch.payments.filter((payment) => payment.status === "success").length;
  const failed = batch.payments.filter((payment) => payment.status === "failed").length;
  const pending = batch.payments.filter((payment) => payment.status === "pending" || payment.status === "processing").length;

  return (
    <div className="batch-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="batch-detail-modal" role="dialog" aria-modal="true" aria-labelledby="batch-detail-title">
        <header className="batch-detail-header">
          <div><p className="eyebrow">Batch details</p><h2 id="batch-detail-title">{batch.name}</h2><p>{new Date(batch.createdAt).toLocaleString([], { dateStyle: "long", timeStyle: "short" })}</p></div>
          <button className="batch-detail-close" onClick={onClose} aria-label="Close batch details" autoFocus><X size={18} /></button>
        </header>

        <div className="batch-detail-summary">
          <div><small>Total amount</small><strong>{formatTokenTotals(batch.totals ?? paymentTotals(validPayments))}</strong></div>
          <div><small>Recipients</small><strong>{validPayments.length}</strong></div>
          <div><small>Settled</small><strong>{successful}</strong></div>
          <div><small>Needs attention</small><strong>{failed + pending}</strong></div>
        </div>

        <div className="batch-detail-meta">
          <span><small>Status</small><b className={`batch-status ${batch.status}`}>{batch.status}</b></span>
          <span><small>Owner</small><b title={batch.owner}>{shortAccount(batch.owner)}</b></span>
          <span><small>Mode</small><b>{batch.mode === "contract" ? "Testnet contract" : "Demo"}</b></span>
          <span><small>Batch ID</small><b title={batch.id}>{batch.contractBatchId ?? shortAccount(batch.id)}</b></span>
        </div>

        {batch.assets && batch.assets.length > 0 && <div className="batch-asset-list"><strong>Contract funding</strong>{batch.assets.map((asset, index) => <span key={`${asset.token}-${asset.contractBatchId ?? index}`}><b>{asset.total} {asset.token}</b><small>{asset.contractBatchId !== undefined ? `Contract batch #${asset.contractBatchId}` : "Awaiting contract ID"}</small>{asset.fundingTxHash && <a href={`https://testnet.nearblocks.io/txns/${asset.fundingTxHash}`} target="_blank" rel="noreferrer">View transaction</a>}</span>)}</div>}

        <div className="batch-payment-heading"><div><strong>Payment contents</strong><small>{batch.payments.length} row{batch.payments.length === 1 ? "" : "s"} from the uploaded file</small></div><button className="button button-outline" onClick={() => downloadCsv(`${batch.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-payments.csv`, paymentsToCsv(batch.payments))}><Download size={15} /> Export CSV</button></div>
        <div className="batch-payment-table" role="table" aria-label={`${batch.name} payments`}>
          <div className="batch-payment-row batch-payment-columns" role="row"><span>Recipient</span><span>Memo / issue</span><span>Amount</span><span>Status</span></div>
          {batch.payments.map((payment) => (
            <div className="batch-payment-row" role="row" key={payment.id}>
              <span className="batch-payment-recipient" role="cell"><b title={payment.recipient}>{payment.recipient}</b><small>{payment.contractBatchId !== undefined ? `Batch #${payment.contractBatchId} · item ${payment.contractItemIndex ?? 0}` : payment.valid ? "Validated recipient" : "Rejected row"}</small></span>
              <span className="batch-payment-memo" role="cell">{payment.issues[0] ?? payment.memo ?? "—"}</span>
              <strong role="cell">{payment.amount} {payment.token ?? "NEAR"}</strong>
              <span role="cell" className={`payment-detail-status ${payment.status}`}>{payment.status}</span>
            </div>
          ))}
        </div>
        {batch.txHash && <footer className="batch-detail-footer"><span>Funding transaction</span><a href={`https://testnet.nearblocks.io/txns/${batch.txHash}`} target="_blank" rel="noreferrer">{batch.txHash}</a></footer>}
      </section>
    </div>
  );
}
