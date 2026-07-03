"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

interface WorkerJob {
  assignmentId: string;
  jobId: string;
  scheduledAt: string | null;
  status: string;
  quotedPriceCents: number;
  finalPriceCents: number | null;
  customerContact: string;
  startsAt: string;
  endsAt: string;
  hoursLogged: number | null;
}

export default function SchedulePage() {
  const [jobs, setJobs] = useState<WorkerJob[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.worker.workerJobs
      .query()
      .then((j) => setJobs(j as WorkerJob[]))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load schedule"));
  }, []);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (jobs.length === 0) {
    return (
      <div>
        <h1>Schedule</h1>
        <p>No upcoming assignments. You're all clear.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Schedule</h1>
      <table>
        <thead>
          <tr>
            <th>Start</th>
            <th>End</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Quoted</th>
            <th>Hours</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.assignmentId}>
              <td>{new Date(j.startsAt).toLocaleString()}</td>
              <td>{new Date(j.endsAt).toLocaleString()}</td>
              <td>{j.customerContact}</td>
              <td>{j.status}</td>
              <td>${(j.quotedPriceCents / 100).toFixed(2)}</td>
              <td>{j.hoursLogged !== null ? j.hoursLogged.toFixed(1) : "—"}</td>
              <td><a href={`/jobs/${j.jobId}`}>Open</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
