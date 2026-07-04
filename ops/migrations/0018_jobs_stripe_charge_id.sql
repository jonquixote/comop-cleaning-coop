-- 0018_jobs_stripe_charge_id.sql — applied as app_owner. v8 review Issue B: the
-- stripe_charge_id column existed on `payments` but was never populated, and there was
-- no canonical place on `jobs` to read "which Stripe charge paid this job". Capture-time
-- reconciliation against Stripe (refunds, disputes, chargebacks) needs the charge id on
-- a durable, per-job row — that's the UPDATE we already do to set status='paid'. Add a
-- nullable text column and let the UPDATE write it. Nullable so existing paid jobs
-- (including the 0015 backfill rows targeting 'backfill-<job_id>') are valid; capturePayment
-- writes it on the next successful delivery for any future retried card flow.

ALTER TABLE jobs ADD COLUMN stripe_charge_id text;
