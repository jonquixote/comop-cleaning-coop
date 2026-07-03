"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../../lib/trpc";

interface JobDetail {
  assignmentId: string;
  memberId: string;
  startsAt: string;
  endsAt: string;
  hoursLogged: number | null;
  assignmentStatus: string;
  jobId: string;
  jobStatus: string;
  quotedPriceCents: number;
  finalPriceCents: number | null;
  breakdown: Record<string, unknown> | null;
  scheduledAt: string | null;
  customerContact: string;
  customerAddress: string | null;
}

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.worker.getJob
      .query({ jobId: params.id })
      .then((j) => setJob(j as JobDetail))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load job"));
  }, [params.id]);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!job) return <p>Loading…</p>;

  return (
    <div>
      <h1>Job #{job.jobId.slice(0, 8)}</h1>
      <dl>
        <dt>Customer</dt><dd>{job.customerContact}</dd>
        <dt>Address</dt><dd>{job.customerAddress ?? "—"}</dd>
        <dt>Scheduled</dt><dd>{job.scheduledAt ?? "—"}</dd>
        <dt>Shift</dt>
        <dd>
          {new Date(job.startsAt).toLocaleString()} → {new Date(job.endsAt).toLocaleString()}
        </dd>
        <dt>Status</dt><dd>{job.jobStatus}</dd>
        <dt>Quoted price</dt><dd>${(job.quotedPriceCents / 100).toFixed(2)}</dd>
        {job.finalPriceCents !== null && (
          <>
            <dt>Final price</dt><dd>${(job.finalPriceCents / 100).toFixed(2)}</dd>
          </>
        )}
        <dt>Hours logged</dt>
        <dd>{job.hoursLogged !== null ? job.hoursLogged.toFixed(2) : "—"}</dd>
        <dt>Checklist</dt>
        <dd>
          <em>
            Cleaning sector checklists are not implemented in MVP. Tracks removed for
            now; the job_assignments row carries hours_logged and that is the source of
            truth for labor basis.
          </em>
        </dd>
      </dl>
      <p>
        <a href="/schedule">← back to schedule</a>
      </p>
    </div>
  );
}
