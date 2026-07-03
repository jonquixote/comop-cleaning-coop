-- 0012_missing_tables.sql — applied as app_owner. Spec §4 tables promised by the
-- implementation spec but never migrated into the platform. Each follows the standard
-- pattern: id uuid PK DEFAULT gen_random_uuid() + co_op_id FK + created_at, RLS ENABLE +
-- FORCE RLS + tenant_isolation policy using the nullif pattern (0003), and a GRANT tier
-- matched to the table's write semantics (full CRUD for operational state, append-only
-- for ledger rows, mutable-no-delete for status machines).
--
-- Six tables in this migration, in this order (FK dependency / logical grouping):
--   1. payroll_sync_records       (audit seam + retry-safe idempotency for payroll provider boundary)
--   2. compliance_records         (operational teeth — blocks dispatch when credentials lapse)
--   3. training_records           (sibling to compliance_records; tracks completions over time)
--   4. membership_fees            (what you pay to join — a fee, NOT equity; deliberate split per spec §4)
--   5. patronage_capital_accounts (equity accrued from labor — one account per member; taxon conformance is
--                                  validated by bylaws + CPA, do NOT rely on balance for filings yet)
--   6. expenses                   (where the money goes — powers transparency + period-health/break-even;
--                                  was missing from the data model and is load-bearing for spec §6)

-- ========== 1. payroll_sync_records ==========
CREATE TABLE payroll_sync_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id          uuid NOT NULL REFERENCES co_ops(id),
  member_id         uuid NOT NULL REFERENCES members(id),
  period_id         uuid NOT NULL REFERENCES allocation_periods(id),
  amount_sent_cents integer NOT NULL,
  sent_at           timestamptz,
  provider          text NOT NULL,
  external_ref      text,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','confirmed','failed')),
  idempotency_key   text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON payroll_sync_records (co_op_id);
CREATE INDEX ON payroll_sync_records (co_op_id, member_id);

ALTER TABLE payroll_sync_records ENABLE ROW LEVEL SECURITY; ALTER TABLE payroll_sync_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_sync_records
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON payroll_sync_records TO app_user;

-- ========== 2. compliance_records ==========
CREATE TABLE compliance_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id         uuid NOT NULL REFERENCES co_ops(id),
  member_id        uuid NOT NULL REFERENCES members(id),
  requirement_key  text NOT NULL,
  status           text NOT NULL CHECK (status IN ('valid','expired','missing')),
  valid_until      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON compliance_records (co_op_id);
CREATE INDEX ON compliance_records (co_op_id, member_id);

ALTER TABLE compliance_records ENABLE ROW LEVEL SECURITY; ALTER TABLE compliance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compliance_records
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON compliance_records TO app_user;

-- ========== 3. training_records ==========
CREATE TABLE training_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id         uuid NOT NULL REFERENCES co_ops(id),
  member_id        uuid NOT NULL REFERENCES members(id),
  requirement_key  text NOT NULL,
  completed_at     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON training_records (co_op_id);
CREATE INDEX ON training_records (co_op_id, member_id);

ALTER TABLE training_records ENABLE ROW LEVEL SECURITY; ALTER TABLE training_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON training_records
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON training_records TO app_user;

-- ========== 4. membership_fees ==========
-- Spec §4: "the fee paid to JOIN (a fee, not equity)". Deliberately separate from
-- patronage_capital_accounts so the schema does not silently encode a legal
-- interpretation. Confirm treatment with CPA before relying on either for filings.
CREATE TABLE membership_fees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id      uuid NOT NULL REFERENCES co_ops(id),
  member_id     uuid NOT NULL REFERENCES members(id),
  amount_cents  integer NOT NULL,
  paid_at       timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON membership_fees (co_op_id);
CREATE INDEX ON membership_fees (co_op_id, member_id);

ALTER TABLE membership_fees ENABLE ROW LEVEL SECURITY; ALTER TABLE membership_fees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_fees
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT ON membership_fees TO app_user;

-- ========== 5. patronage_capital_accounts ==========
-- Spec §4: "equity accrued from labor, payable out per bylaws". One row per
-- member (UNIQUE member_id). Tax-conformant patronage treatment is validated by
-- bylaws + CPA (spec §9). Do not rely on this balance for filings or member tax
-- statements until treatment is confirmed.
CREATE TABLE patronage_capital_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id       uuid NOT NULL REFERENCES co_ops(id),
  member_id      uuid NOT NULL REFERENCES members(id) UNIQUE,
  balance_cents  integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE patronage_capital_accounts IS
  'Tax-conformant patronage treatment is validated by bylaws + CPA (spec §9). Do not rely on this balance for filings until confirmed.';
CREATE INDEX ON patronage_capital_accounts (co_op_id);

ALTER TABLE patronage_capital_accounts ENABLE ROW LEVEL SECURITY; ALTER TABLE patronage_capital_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patronage_capital_accounts
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON patronage_capital_accounts TO app_user;

-- ========== 6. expenses ==========
-- Spec §4: "where the money goes; powers transparency + anti-waste". Required for
-- make the period-health / break-even surface (spec §6) compute surplus and the
-- break-even line, instead of being an empty stub. Inserts and mutations from app
-- surfaces; deletion is intentionally NOT granted (expenses should not be silently
-- erased — corrections are new rows that net to zero if needed).
CREATE TABLE expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id     uuid NOT NULL REFERENCES co_ops(id),
  category     text NOT NULL,
  amount_cents integer NOT NULL,
  incurred_at  timestamptz NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON expenses (co_op_id);
CREATE INDEX ON expenses (co_op_id, incurred_at DESC);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY; ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expenses
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON expenses TO app_user;
