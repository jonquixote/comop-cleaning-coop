-- 0020_payment_fk_tenant_isolation.sql — applied as app_owner.
-- FK checks bypass RLS (the same fact governance.castVote guards against in the app layer).
-- As shipped, payments.job_id / payments.customer_id / refund_ledger.payment_id are
-- single-column FKs that only prove the referenced row EXISTS — not that it belongs to the
-- same co-op. That leaves a cross-tenant hole: a payments row in co-op A could reference a
-- job or customer in co-op B (RLS on the row's own co_op_id does not check the target's).
-- Fix: make the referenced (co_op_id, id) pair a UNIQUE target and re-point each FK at the
-- COMPOSITE (co_op_id, <fk>) — the database now refuses any reference whose tenant differs.

-- Composite UNIQUE targets (id is already the PK, so these are trivially satisfied by
-- existing data; they exist to be FK-referenceable).
ALTER TABLE jobs      ADD CONSTRAINT jobs_co_op_id_id_key      UNIQUE (co_op_id, id);
ALTER TABLE customers ADD CONSTRAINT customers_co_op_id_id_key UNIQUE (co_op_id, id);
ALTER TABLE payments  ADD CONSTRAINT payments_co_op_id_id_key  UNIQUE (co_op_id, id);

-- payments → jobs / customers: drop the tenant-blind single-column FKs, add composite ones.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_job_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_job_fkey
  FOREIGN KEY (co_op_id, job_id) REFERENCES jobs (co_op_id, id);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_customer_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_customer_fkey
  FOREIGN KEY (co_op_id, customer_id) REFERENCES customers (co_op_id, id);

-- refund_ledger → payments: same treatment.
ALTER TABLE refund_ledger DROP CONSTRAINT IF EXISTS refund_ledger_payment_id_fkey;
ALTER TABLE refund_ledger ADD CONSTRAINT refund_ledger_payment_fkey
  FOREIGN KEY (co_op_id, payment_id) REFERENCES payments (co_op_id, id);
