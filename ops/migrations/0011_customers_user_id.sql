-- 0011_customers_user_id.sql — applied as app_owner. Links customers to users so that
-- booking.list can find a customer via their session userId (ADR-0004 §3). Before this,
-- customers was only a contact/address record with no link to the identity subsystem.
-- Also adds co_ops.slug for public-facing co-op identification at registration (the
-- customer knows their co-op by a short slug, not a UUID).

ALTER TABLE co_ops ADD COLUMN slug text UNIQUE;
ALTER TABLE customers ADD COLUMN user_id uuid REFERENCES users(id);
CREATE INDEX ON customers (co_op_id, user_id);

-- Genesis slug for existing co-ops (idempotent on re-run since slug is nullable).
UPDATE co_ops SET slug = 'coop-a' WHERE id = '00000000-0000-0000-0000-00000000000a';
UPDATE co_ops SET slug = 'coop-b' WHERE id = '00000000-0000-0000-0000-00000000000b';

-- Genesis surplus_split policy for co-op A (required by createCleaningBooking).
-- Without this, resolveCurrentPolicySnapshot throws "no surplus_split policy set".
INSERT INTO policy_settings (co_op_id, key, value_json)
SELECT '00000000-0000-0000-0000-00000000000a', 'surplus_split', '{"fraction":0.2}'
WHERE NOT EXISTS (
  SELECT 1 FROM policy_settings
  WHERE co_op_id = '00000000-0000-0000-0000-00000000000a' AND key = 'surplus_split'
);
