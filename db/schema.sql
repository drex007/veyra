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
);

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
);

CREATE INDEX IF NOT EXISTS veyra_batches_owner_created_idx
  ON veyra_batches(owner, created_at DESC);
