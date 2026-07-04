-- 0017_refund_ledger.sql — applied as app_owner. APPEND-ONLY refund ledger: the
-- survivor of v8 review's Issue A. The prior recordRefund() inside platform/payments/
-- payments.ts UPDATEd the payments row, which silently allowed double refunds to
-- overwrite (status moved from 'succeeded' → 'refunded' and was re-applied on a
-- second call without warning). So we move to an honest, append-only ledger —
-- corrections become new rows, not edits — mirroring the payout_ledger pattern
-- (0007_payout_ledger.sql).
--
-- One row per refund issued against a payments row. UNIQUE(payment_id) makes the
-- INSERT idempotent at the conflict target (re-issue attempts become no-ops and
-- recordRefund returns recorded=false). Multi-tenant RLS, APPEND-ONLY grants.

CREATE TABLE refund_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id            uuid NOT NULL REFERENCES co_ops(id),
  payment_id          uuid NOT NULL REFERENCES payments(id),
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  reason              text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id)
);
CREATE INDEX ON refund_ledger (co_op_id);

ALTER TABLE refund_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refund_ledger
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT ON refund_ledger TO app_user;
