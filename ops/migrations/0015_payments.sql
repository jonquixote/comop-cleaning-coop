-- 0015_payments.sql — applied as app_owner. Customer payment records (spec §4).
-- One row per successful Stripe capture; status transitions: pending→succeeded|failed→refunded.
-- MUTABLE-NO-DELETE: app_user can transition status but never delete payment rows.
--
-- UNIQUE(job_id) is deliberately absent: a failed-card retry with a new Stripe PaymentIntent
-- creates a second row (different stripe_payment_intent_id). Webhook_events UNIQUE(stripe_event_id)
-- is the canonical idempotency guard against duplicate webhook delivery.
--
-- Backfill: copies existing paid jobs (from before this migration) into payments so
-- period-health queries don't show $0 revenue for historical periods.

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id          uuid NOT NULL REFERENCES co_ops(id),
  job_id            uuid NOT NULL REFERENCES jobs(id),
  customer_id       uuid NOT NULL REFERENCES customers(id),
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  stripe_payment_intent_id text,
  stripe_charge_id  text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','succeeded','failed','refunded','disputed')),
  paid_at           timestamptz,
  failure_reason    text,
  refunded_at       timestamptz,
  refund_amount_cents integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status != 'succeeded' OR paid_at IS NOT NULL)
);

CREATE INDEX ON payments (co_op_id);
CREATE INDEX ON payments (co_op_id, job_id);
CREATE INDEX ON payments (co_op_id, customer_id);
CREATE INDEX ON payments (co_op_id, status);
CREATE INDEX ON payments (stripe_payment_intent_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON payments TO app_user;

-- Backfill: create payments rows for every job that was already paid before this migration.
-- stripe_payment_intent_id is prefixed 'backfill-' for historical rows;
-- these are NOT real Stripe IDs. Do not use them in Stripe API calls.
-- Idempotent on re-run (v8 review Issue C): the payments table has NO unique constraint
-- to conflict against, so a plain ON CONFLICT DO NOTHING is a silent no-op and a re-run
-- inserts duplicates. WHERE NOT EXISTS guards on the (co_op_id, job_id) pair we expect
-- to have backfilled for — exactly one payments row per existing paid job.
INSERT INTO payments (co_op_id, job_id, customer_id, amount_cents,
                      stripe_payment_intent_id, status, paid_at)
SELECT co_op_id, id, customer_id, final_price_cents,
       'backfill-' || id, 'succeeded', COALESCE(updated_at, created_at)
FROM jobs
WHERE status = 'paid'
  AND final_price_cents IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM payments
    WHERE payments.co_op_id = jobs.co_op_id
      AND payments.job_id     = jobs.id
  );

CREATE OR REPLACE FUNCTION set_payments_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_payments_updated_at();
