-- 0008_webhook_events.sql — applied as app_owner. Stripe idempotency ledger (build-order
-- step 5). ADR-0007: TENANT-SCOPED (co_op_id resolved from the payment), append-only.
-- UNIQUE(stripe_event_id) gives GLOBAL exactly-once (the constraint check bypasses RLS), so
-- a duplicate webhook delivery is dropped regardless of tenant context (threat-model mode 2).
-- Also extends the jobs status set with 'paid'.

ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('quoted','scheduled','in_progress','done','paid','cancelled'));

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),          -- ADR-0007: tenant-scoped, from the payment
  provider text NOT NULL DEFAULT 'stripe',
  stripe_event_id text NOT NULL,                          -- Stripe idempotency key (payment-intent id at capture)
  job_id uuid NOT NULL REFERENCES jobs(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','ignored')),
  UNIQUE (stripe_event_id)                                -- GLOBAL exactly-once (bypasses RLS)
);
CREATE INDEX ON webhook_events (co_op_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY; ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_events
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

-- APPEND-ONLY: deliberately SELECT + INSERT only. NO UPDATE, NO DELETE for app_user.
GRANT SELECT, INSERT ON webhook_events TO app_user;
