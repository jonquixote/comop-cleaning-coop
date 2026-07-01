-- 0010b_valve_hardening.sql — applied as app_owner. Governance authz hardening (Step 7
-- security review). A single passed proposal may set surplus_split EXACTLY ONCE:
-- UNIQUE(set_by_proposal_id) makes reuse structurally impossible. NULLs remain distinct in a
-- UNIQUE index, so ordinary policy rows (set_by_proposal_id NULL) are unaffected. Pairs with
-- the valve.ts guards (type = 'surplus_split', 0 <= fraction <= 1, one-shot).
ALTER TABLE policy_settings
  ADD CONSTRAINT policy_settings_set_by_proposal_unique UNIQUE (set_by_proposal_id);
