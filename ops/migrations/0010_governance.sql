-- 0010_governance.sql — applied as app_owner. Governance + the valve (build-order step 7).
-- proposals (mutable status), votes (append-only, one per member), communications (append-only).
-- Tenant-scoped default-deny RLS (nullif). ADR-0008: decision-mode economics live on the
-- proposal (transparency_snapshot_json); a BEFORE INSERT trigger enforces the mandatory
-- write-constraint on communications. Also wires the set_by_proposal_id FK now that proposals exist.

CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  title text NOT NULL,
  body text,
  type text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','passed','failed','withdrawn')),
  stakes_level text NOT NULL DEFAULT 'routine' CHECK (stakes_level IN ('routine','high')),
  transparency_snapshot_json jsonb,              -- ADR-0008: the decision's computable economics
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON proposals (co_op_id);

CREATE TABLE votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  proposal_id uuid NOT NULL REFERENCES proposals(id),
  member_id uuid NOT NULL REFERENCES members(id),
  choice text NOT NULL CHECK (choice IN ('yes','no','abstain')),
  cast_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, member_id)                -- one vote per member per proposal
);
CREATE INDEX ON votes (co_op_id, proposal_id);

CREATE TABLE communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_op_id uuid NOT NULL REFERENCES co_ops(id),
  mode text NOT NULL CHECK (mode IN ('routine','decision')),
  proposal_id uuid REFERENCES proposals(id),     -- required for decision mode (enforced by trigger below)
  body text NOT NULL,
  audience text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON communications (co_op_id);

-- close the loop with Step 2: surplus_split policy rows are stamped with the passing proposal.
ALTER TABLE policy_settings
  ADD CONSTRAINT policy_settings_set_by_proposal_fk FOREIGN KEY (set_by_proposal_id) REFERENCES proposals(id);

-- ---- RLS default-deny (nullif) ----
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY; ALTER TABLE proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON proposals
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE votes ENABLE ROW LEVEL SECURITY; ALTER TABLE votes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON votes
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

ALTER TABLE communications ENABLE ROW LEVEL SECURITY; ALTER TABLE communications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON communications
  USING      (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid)
  WITH CHECK (co_op_id = nullif(current_setting('app.current_co_op', true), '')::uuid);

-- proposals: app_user reads, creates (INSERT), transitions status (UPDATE).
GRANT SELECT, INSERT, UPDATE ON proposals TO app_user;
-- votes + communications: APPEND-ONLY (SELECT + INSERT only).
GRANT SELECT, INSERT ON votes TO app_user;
GRANT SELECT, INSERT ON communications TO app_user;

-- ---- the mandatory write-constraint (§8a, ADR-0008), enforced at write time in the DB ----
CREATE FUNCTION enforce_decision_comm_economics() RETURNS trigger AS $$
BEGIN
  IF NEW.mode = 'decision' THEN
    IF NEW.proposal_id IS NULL THEN
      RAISE EXCEPTION 'decision-mode communication requires a linked proposal';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = NEW.proposal_id AND p.transparency_snapshot_json IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'decision-mode communication requires the proposal to carry computable economics (transparency_snapshot_json)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_decision_comm_economics
  BEFORE INSERT ON communications
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_comm_economics();
