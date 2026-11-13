export type PaymentStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "cancelled";

export type BatchStatus = "draft" | "ready" | "processing" | "complete" | "cancelled";
export type PaymentToken = "NEAR" | "USDC" | "USDT";

export interface TokenTotal {
  token: PaymentToken;
  amount: number;
}

export interface CsvPayment {
  id: string;
  recipient: string;
  amount: string;
  token: PaymentToken;
  memo: string;
  status: PaymentStatus;
  valid: boolean;
  exists: boolean | null;
  riskScore: number;
  issues: string[];
  txHash?: string;
  contractBatchId?: number;
  contractItemIndex?: number;
}

export interface ValidationPolicy {
  maxPerRecipient: number;
  requireExistingAccount: boolean;
  blockDuplicates: boolean;
  useOpenAI: boolean;
}

export interface AgentAnalysis {
  enabled: boolean;
  source: "openai" | "policy-engine";
  model: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  reviewRequired: boolean;
  reviewedRows: number;
  flaggedRows: number;
  flaggedRecipients: string[];
  recommendations: string[];
  findings: IntelligenceFinding[];
}

export type IntelligenceSeverity = "info" | "warning" | "critical";

export interface IntelligenceFinding {
  code: string;
  category: "duplicate" | "amount" | "account" | "policy" | "execution" | "reconciliation";
  severity: IntelligenceSeverity;
  title: string;
  affectedPaymentIds: string[];
  evidence: string;
  explanation: string;
  suggestedAction: string;
}

export interface InvestigationEvidence {
  source: "payment-record" | "transaction-receipt" | "escrow-contract";
  reference: string;
  verified: boolean;
  detail: string;
}

export interface PaymentInvestigation {
  enabled: boolean;
  source: "openai" | "policy-engine";
  model: string;
  answer: string;
  summary: string;
  failedPayments: number;
  successfulPayments: number;
  recoverableTotals: TokenTotal[];
  findings: IntelligenceFinding[];
  nextActions: string[];
  evidence: InvestigationEvidence[];
  generatedAt: string;
}

export interface VeyraBatch {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  status: BatchStatus;
  payments: CsvPayment[];
  total: number;
  totals?: TokenTotal[];
  assets?: VeyraAssetBatch[];
  txHash?: string;
  contractBatchId?: number;
  mode: "demo" | "contract";
}

export interface VeyraAssetBatch {
  token: PaymentToken;
  total: number;
  contractBatchId?: number;
  fundingTxHash?: string;
}

export interface ValidationSummary {
  payments: CsvPayment[];
  accepted: number;
  rejected: number;
  warnings: number;
  totalAccepted: number;
  totalsAccepted: TokenTotal[];
  checkedAt: string;
  aiAnalysis?: AgentAnalysis;
}
