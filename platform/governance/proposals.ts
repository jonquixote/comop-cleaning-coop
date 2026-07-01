// Governance — proposals + voting (platform, sector-agnostic). One-worker-one-vote within
// the co-op; one vote per member per proposal (app-layer check + DB UNIQUE backstop).
// Runs in the caller's tenant transaction.
import type { PoolClient } from "pg";
import { GovernanceError } from "./errors";

export interface CreateProposalInput {
  title: string;
  body?: string;
  type?: string;
  stakesLevel?: "routine" | "high";
  transparencySnapshot?: unknown; // ADR-0008: the decision's computable economics
}

export async function createProposal(
  tx: PoolClient,
  coOpId: string,
  input: CreateProposalInput,
): Promise<{ proposalId: string }> {
  const r = await tx.query(
    `INSERT INTO proposals (co_op_id, title, body, type, stakes_level, transparency_snapshot_json)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      coOpId,
      input.title,
      input.body ?? null,
      input.type ?? null,
      input.stakesLevel ?? "routine",
      input.transparencySnapshot ?? null,
    ],
  );
  return { proposalId: r.rows[0].id as string };
}

async function requireStatus(tx: PoolClient, coOpId: string, proposalId: string, want: string): Promise<void> {
  const p = await tx.query("SELECT status FROM proposals WHERE id = $1 AND co_op_id = $2", [proposalId, coOpId]);
  if (p.rowCount === 0) throw new GovernanceError("proposal not found");
  if (p.rows[0].status !== want) throw new GovernanceError(`proposal is '${p.rows[0].status}', expected '${want}'`);
}

export async function openProposal(tx: PoolClient, coOpId: string, proposalId: string): Promise<void> {
  await requireStatus(tx, coOpId, proposalId, "draft");
  await tx.query("UPDATE proposals SET status='open', opens_at=now() WHERE id=$1 AND co_op_id=$2", [proposalId, coOpId]);
}

export async function castVote(
  tx: PoolClient,
  coOpId: string,
  proposalId: string,
  memberId: string,
  choice: "yes" | "no" | "abstain",
): Promise<void> {
  await requireStatus(tx, coOpId, proposalId, "open");
  // voter must be an active member OF THIS co-op — rejects cross-tenant members (FK checks
  // bypass RLS) and probationary members.
  const eligible = await tx.query(
    "SELECT 1 FROM members WHERE id = $1 AND co_op_id = $2 AND status = 'member'",
    [memberId, coOpId],
  );
  if (eligible.rowCount === 0) throw new GovernanceError("not an eligible voting member of this co-op");
  const existing = await tx.query("SELECT 1 FROM votes WHERE proposal_id=$1 AND member_id=$2", [proposalId, memberId]);
  if ((existing.rowCount ?? 0) > 0) throw new GovernanceError("member has already voted on this proposal");
  await tx.query(
    "INSERT INTO votes (co_op_id, proposal_id, member_id, choice) VALUES ($1,$2,$3,$4)",
    [coOpId, proposalId, memberId, choice],
  );
}

export async function closeProposal(
  tx: PoolClient,
  coOpId: string,
  proposalId: string,
): Promise<{ status: "passed" | "failed"; yes: number; no: number }> {
  await requireStatus(tx, coOpId, proposalId, "open");
  const tally = await tx.query(
    `SELECT
       COUNT(*) FILTER (WHERE choice='yes')::int AS yes,
       COUNT(*) FILTER (WHERE choice='no')::int  AS no
     FROM votes WHERE proposal_id = $1`,
    [proposalId],
  );
  const yes = tally.rows[0].yes as number;
  const no = tally.rows[0].no as number;
  const status: "passed" | "failed" = yes > no ? "passed" : "failed";
  await tx.query("UPDATE proposals SET status=$3, closes_at=now() WHERE id=$1 AND co_op_id=$2", [proposalId, coOpId, status]);
  return { status, yes, no };
}
