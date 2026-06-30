// Job completion write-back (platform, sector-agnostic). Logs hours onto the assignment
// (the patronage labor basis), marks it completed and the parent job done. Guarded so a job
// cannot be completed twice and hours must be positive. Runs in the caller's tenant tx.
import type { PoolClient } from "pg";

export class CompletionError extends Error {}

export interface CompleteJobInput {
  assignmentId: string;
  hoursLogged: number;
}

export async function completeJob(
  tx: PoolClient,
  coOpId: string,
  input: CompleteJobInput,
): Promise<{ jobId: string }> {
  if (!(input.hoursLogged > 0)) {
    throw new CompletionError("hours_logged must be positive");
  }

  const a = await tx.query(
    "SELECT job_id, status FROM job_assignments WHERE id = $1 AND co_op_id = $2",
    [input.assignmentId, coOpId],
  );
  if (a.rowCount === 0) throw new CompletionError("assignment not found");
  if (a.rows[0].status !== "assigned") {
    throw new CompletionError(`assignment is '${a.rows[0].status}', not open for completion`);
  }
  const jobId = a.rows[0].job_id as string;

  await tx.query(
    "UPDATE job_assignments SET hours_logged = $2, status = 'completed' WHERE id = $1",
    [input.assignmentId, input.hoursLogged],
  );
  await tx.query(
    "UPDATE jobs SET status = 'done', final_price_cents = quoted_price_cents WHERE id = $1",
    [jobId],
  );
  return { jobId };
}
