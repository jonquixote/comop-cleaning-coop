// Cleaning booking → job (sector-owned). Snapshots the applicable policy version onto the
// job at quote time T; the job carries that policy_version_id for its whole life, so a later
// vote changes future quotes only (impl §5). Operates inside the caller's tenant transaction
// (the app provides `tx` via withSessionTx; booking never imports the internal db helper).
import type { PoolClient } from "pg";
import { priceJob, type CleaningJobDetails } from "./pricing";
import { resolveCurrentPolicySnapshot } from "../../platform/policy/policy";

export interface BookingInput {
  customerId: string;
  scheduledAt?: string;
  details: CleaningJobDetails;
}

export interface BookedJob {
  jobId: string;
  quotedPriceCents: number;
  policyVersionId: string;
}

export async function createCleaningBooking(
  tx: PoolClient,
  coOpId: string,
  input: BookingInput,
): Promise<BookedJob> {
  const snapshot = await resolveCurrentPolicySnapshot(tx); // freeze the current surplus_split version
  const breakdown = priceJob(input.details, snapshot);

  const job = await tx.query(
    `INSERT INTO jobs
       (co_op_id, customer_id, sector, scheduled_at, status, quoted_price_cents, policy_version_id, breakdown_json)
     VALUES ($1, $2, 'cleaning', $3, 'quoted', $4, $5, $6)
     RETURNING id`,
    [coOpId, input.customerId, input.scheduledAt ?? null, breakdown.final_price_cents, snapshot.policyVersionId, breakdown],
  );
  const jobId = job.rows[0].id as string;

  await tx.query(
    `INSERT INTO job_cleaning_details (job_id, co_op_id, sqft, bedrooms, bathrooms, addons)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [jobId, coOpId, input.details.sqft, input.details.bedrooms, input.details.bathrooms, input.details.addons],
  );

  return { jobId, quotedPriceCents: breakdown.final_price_cents, policyVersionId: snapshot.policyVersionId };
}
