// Communications — the valve made structural (platform, impl §6; ADR-0008). A decision-mode
// communication is unsendable unless it links a proposal that carries computable economics
// (transparency_snapshot_json non-null). Pre-checked here for a clean error; the DB trigger
// (0010) is the write-time guarantee that a direct INSERT cannot bypass. Runs in the caller's tx.
import type { PoolClient } from "pg";
import { GovernanceError } from "./errors";

export interface CreateCommunicationInput {
  mode: "routine" | "decision";
  proposalId?: string;
  body: string;
  audience?: string;
}

export async function createCommunication(
  tx: PoolClient,
  coOpId: string,
  input: CreateCommunicationInput,
): Promise<{ communicationId: string }> {
  // Any linked proposal must belong to THIS co-op — enforced in EVERY mode, so a routine
  // comm cannot silently link a cross-tenant proposal (FK checks bypass RLS).
  let linked: { transparency_snapshot_json: unknown } | undefined;
  if (input.proposalId) {
    const p = await tx.query(
      "SELECT transparency_snapshot_json FROM proposals WHERE id = $1 AND co_op_id = $2",
      [input.proposalId, coOpId],
    );
    if (p.rowCount === 0) throw new GovernanceError("linked proposal not found");
    linked = p.rows[0];
  }
  if (input.mode === "decision") {
    if (!linked) {
      throw new GovernanceError("decision-mode communication requires a linked proposal");
    }
    if (linked.transparency_snapshot_json == null) {
      throw new GovernanceError("decision-mode communication requires the proposal to carry computable economics");
    }
  }
  const r = await tx.query(
    "INSERT INTO communications (co_op_id, mode, proposal_id, body, audience) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [coOpId, input.mode, input.proposalId ?? null, input.body, input.audience ?? null],
  );
  return { communicationId: r.rows[0].id as string };
}
