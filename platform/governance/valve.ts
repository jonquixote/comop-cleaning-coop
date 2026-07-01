// The valve (platform, sector-agnostic — impl §6). The pay↔price lever `surplus_split` can
// change ONLY via a passed proposal — never directly. Writes a NEW versioned policy_settings
// row stamped with set_by_proposal_id, closing the loop with Step 2's snapshot: future quotes
// pick up the new version; in-flight jobs stay frozen on their snapshot. Runs in the caller's tx.
import type { PoolClient } from "pg";
import { GovernanceError } from "./errors";

export async function setSurplusSplitByProposal(
  tx: PoolClient,
  coOpId: string,
  proposalId: string,
  fraction: number,
): Promise<{ policyVersionId: string }> {
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new GovernanceError("surplus_split fraction must be between 0 and 1");
  }
  const p = await tx.query("SELECT status, type FROM proposals WHERE id = $1 AND co_op_id = $2", [proposalId, coOpId]);
  if (p.rowCount === 0) throw new GovernanceError("proposal not found");
  if (p.rows[0].type !== "surplus_split") {
    throw new GovernanceError("proposal is not a surplus_split proposal");
  }
  if (p.rows[0].status !== "passed") {
    throw new GovernanceError("surplus_split can only be set by a PASSED proposal");
  }
  // one passed proposal sets the split EXACTLY once (app check + UNIQUE(set_by_proposal_id) backstop)
  const already = await tx.query("SELECT 1 FROM policy_settings WHERE set_by_proposal_id = $1", [proposalId]);
  if ((already.rowCount ?? 0) > 0) {
    throw new GovernanceError("this proposal has already set the surplus_split");
  }
  const r = await tx.query(
    `INSERT INTO policy_settings (co_op_id, key, value_json, effective_from, set_by_proposal_id)
     VALUES ($1, 'surplus_split', $2, now(), $3) RETURNING id`,
    [coOpId, JSON.stringify({ fraction }), proposalId],
  );
  return { policyVersionId: r.rows[0].id as string };
}
