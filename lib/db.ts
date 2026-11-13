import postgres, { type Sql } from "postgres";
import type { CsvPayment, TokenTotal, VeyraAssetBatch, VeyraBatch } from "@/lib/types";

declare global {
  var veyraSql: Sql | undefined;
  var veyraSchemaReady: Promise<void> | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getSql(): Sql {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!globalThis.veyraSql) {
    globalThis.veyraSql = postgres(process.env.DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    });
  }
  return globalThis.veyraSql;
}

async function ensureSchema(): Promise<void> {
  if (!globalThis.veyraSchemaReady) {
    const sql = getSql();
    const schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS veyra_batches (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner TEXT NOT NULL,
          status TEXT NOT NULL,
          mode TEXT NOT NULL,
          total_near NUMERIC(40, 24) NOT NULL,
          totals JSONB NOT NULL DEFAULT '[]'::jsonb,
          assets JSONB NOT NULL DEFAULT '[]'::jsonb,
          chain_batch_id BIGINT,
          tx_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS veyra_payments (
          batch_id TEXT NOT NULL REFERENCES veyra_batches(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          recipient TEXT NOT NULL,
          amount_near NUMERIC(40, 24) NOT NULL,
          token TEXT NOT NULL DEFAULT 'NEAR',
          memo TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          valid BOOLEAN NOT NULL,
          account_exists BOOLEAN,
          risk_score INTEGER NOT NULL DEFAULT 0,
          issues JSONB NOT NULL DEFAULT '[]'::jsonb,
          tx_hash TEXT,
          contract_batch_id BIGINT,
          contract_item_index INTEGER,
          PRIMARY KEY (batch_id, id)
        )
      `;
      await sql`ALTER TABLE veyra_batches ADD COLUMN IF NOT EXISTS totals JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await sql`ALTER TABLE veyra_batches ADD COLUMN IF NOT EXISTS assets JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await sql`ALTER TABLE veyra_payments ADD COLUMN IF NOT EXISTS token TEXT NOT NULL DEFAULT 'NEAR'`;
      await sql`ALTER TABLE veyra_payments ADD COLUMN IF NOT EXISTS contract_batch_id BIGINT`;
      await sql`ALTER TABLE veyra_payments ADD COLUMN IF NOT EXISTS contract_item_index INTEGER`;
      await sql`CREATE INDEX IF NOT EXISTS veyra_batches_owner_created_idx ON veyra_batches(owner, created_at DESC)`;
    })();
    globalThis.veyraSchemaReady = schemaReady;
    void schemaReady.catch(() => {
      if (globalThis.veyraSchemaReady === schemaReady) {
        globalThis.veyraSchemaReady = undefined;
      }
    });
  }
  await globalThis.veyraSchemaReady;
}

export async function saveBatchToDatabase(batch: VeyraBatch): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO veyra_batches (
        id, name, owner, status, mode, total_near, totals, assets, chain_batch_id, tx_hash, created_at, updated_at
      ) VALUES (
        ${batch.id}, ${batch.name}, ${batch.owner}, ${batch.status}, ${batch.mode}, ${batch.total},
        ${transaction.json(batch.totals ?? [])}, ${transaction.json(batch.assets ?? [])},
        ${batch.contractBatchId ?? null}, ${batch.txHash ?? null}, ${new Date(batch.createdAt)}, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        owner = EXCLUDED.owner,
        status = EXCLUDED.status,
        mode = EXCLUDED.mode,
        total_near = EXCLUDED.total_near,
        totals = EXCLUDED.totals,
        assets = EXCLUDED.assets,
        chain_batch_id = EXCLUDED.chain_batch_id,
        tx_hash = EXCLUDED.tx_hash,
        updated_at = NOW()
    `;
    for (const payment of batch.payments) {
      await transaction`
        INSERT INTO veyra_payments (
          batch_id, id, recipient, amount_near, token, memo, status, valid,
          account_exists, risk_score, issues, tx_hash, contract_batch_id, contract_item_index
        ) VALUES (
          ${batch.id}, ${payment.id}, ${payment.recipient}, ${payment.amount || "0"}, ${payment.token ?? "NEAR"}, ${payment.memo},
          ${payment.status}, ${payment.valid}, ${payment.exists}, ${payment.riskScore},
          ${transaction.json(payment.issues)}, ${payment.txHash ?? null},
          ${payment.contractBatchId ?? null}, ${payment.contractItemIndex ?? null}
        )
        ON CONFLICT (batch_id, id) DO UPDATE SET
          recipient = EXCLUDED.recipient,
          amount_near = EXCLUDED.amount_near,
          token = EXCLUDED.token,
          memo = EXCLUDED.memo,
          status = EXCLUDED.status,
          valid = EXCLUDED.valid,
          account_exists = EXCLUDED.account_exists,
          risk_score = EXCLUDED.risk_score,
          issues = EXCLUDED.issues,
          tx_hash = EXCLUDED.tx_hash,
          contract_batch_id = EXCLUDED.contract_batch_id,
          contract_item_index = EXCLUDED.contract_item_index
      `;
    }
  });
}

interface BatchRow {
  id: string;
  name: string;
  owner: string;
  status: VeyraBatch["status"];
  mode: VeyraBatch["mode"];
  total_near: string;
  totals: TokenTotal[];
  assets: VeyraAssetBatch[];
  chain_batch_id: string | null;
  tx_hash: string | null;
  created_at: Date;
}

interface PaymentRow {
  id: string;
  recipient: string;
  amount_near: string;
  token: CsvPayment["token"];
  memo: string;
  status: CsvPayment["status"];
  valid: boolean;
  account_exists: boolean | null;
  risk_score: number;
  issues: string[];
  tx_hash: string | null;
  contract_batch_id: string | null;
  contract_item_index: number | null;
}

export async function getBatchesFromDatabase(owner: string): Promise<VeyraBatch[]> {
  await ensureSchema();
  const sql = getSql();
  const batchRows = await sql<BatchRow[]>`
    SELECT id, name, owner, status, mode, total_near, totals, assets, chain_batch_id, tx_hash, created_at
    FROM veyra_batches
    WHERE owner = ${owner}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return Promise.all(batchRows.map(async (batch): Promise<VeyraBatch> => {
    const paymentRows = await sql<PaymentRow[]>`
      SELECT id, recipient, amount_near, token, memo, status, valid, account_exists,
             risk_score, issues, tx_hash, contract_batch_id, contract_item_index
      FROM veyra_payments
      WHERE batch_id = ${batch.id}
      ORDER BY id ASC
    `;
    return {
      id: batch.id,
      name: batch.name,
      owner: batch.owner,
      createdAt: batch.created_at.toISOString(),
      status: batch.status,
      mode: batch.mode,
      total: Number(batch.total_near),
      totals: batch.totals,
      assets: batch.assets,
      contractBatchId: batch.chain_batch_id === null ? undefined : Number(batch.chain_batch_id),
      txHash: batch.tx_hash ?? undefined,
      payments: paymentRows.map((payment) => ({
        id: payment.id,
        recipient: payment.recipient,
        amount: payment.amount_near,
        token: payment.token,
        memo: payment.memo,
        status: payment.status,
        valid: payment.valid,
        exists: payment.account_exists,
        riskScore: payment.risk_score,
        issues: payment.issues,
        txHash: payment.tx_hash ?? undefined,
        contractBatchId: payment.contract_batch_id === null ? undefined : Number(payment.contract_batch_id),
        contractItemIndex: payment.contract_item_index ?? undefined,
      })),
    };
  }));
}
