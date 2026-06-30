// Dispatch engine (platform, sector-agnostic — ADR-0001). Owns time windows, worker
// availability, and assignment constraints (the when/who/where-order of work). NO route
// optimization at MVP. Sectors own duration estimation; the dispatcher supplies the shift
// window. Operates inside the caller's tenant transaction.
import type { PoolClient } from "pg";

export class DispatchError extends Error {}

export interface AssignmentRequest {
  jobId: string;
  memberId: string;
  startsAt: string; // ISO 8601 UTC
  endsAt: string; // ISO 8601 UTC
}

export async function assignJob(
  tx: PoolClient,
  coOpId: string,
  req: AssignmentRequest,
): Promise<{ assignmentId: string }> {
  // 1. availability — a single window must cover the whole requested shift
  const avail = await tx.query(
    `SELECT 1 FROM worker_availability
     WHERE member_id = $1 AND starts_at <= $2 AND ends_at >= $3
     LIMIT 1`,
    [req.memberId, req.startsAt, req.endsAt],
  );
  if (avail.rowCount === 0) {
    throw new DispatchError("member is not available for the requested window");
  }

  // 2. conflict — no existing (non-cancelled) assignment for this member may overlap.
  //    Overlap iff existing.starts_at < req.ends_at AND existing.ends_at > req.starts_at.
  const conflict = await tx.query(
    `SELECT 1 FROM job_assignments
     WHERE member_id = $1 AND status <> 'cancelled'
       AND starts_at < $3 AND ends_at > $2
     LIMIT 1`,
    [req.memberId, req.startsAt, req.endsAt],
  );
  if ((conflict.rowCount ?? 0) > 0) {
    throw new DispatchError("requested shift conflicts with an existing assignment");
  }

  // 3. assign
  const r = await tx.query(
    `INSERT INTO job_assignments (co_op_id, job_id, member_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [coOpId, req.jobId, req.memberId, req.startsAt, req.endsAt],
  );
  return { assignmentId: r.rows[0].id as string };
}
