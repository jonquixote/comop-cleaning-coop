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

interface ChecklistTask {
  description: string;
  optional: boolean;
  completed?: boolean;
}

interface ChecklistSection {
  id: string;
  room: string;
  tasks: ChecklistTask[];
  completed: boolean;
}

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistSection[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      trpc.worker.getJob.query({ jobId: params.id }),
      trpc.worker.getJobChecklists.query({ jobId: params.id }),
    ]).then(([j, items]) => {
      setJob(j as JobDetail);
      setChecklist(items as ChecklistSection[]);
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load job"));
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
          {checklist.length === 0 ? (
            <em>No checklist items for this job.</em>
          ) : (
            checklist.map((section) => (
              <details key={section.id} style={{ marginBottom: "0.5rem" }}>
                <summary>
                  {section.room}
                  {section.completed ? " ✅" : ""}
                </summary>
                <ul style={{ listStyle: "none", paddingLeft: "1rem" }}>
                  {section.tasks.map((task, i) => (
                    <li key={i}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!task.completed}
                          onChange={() => {
                            trpc.worker.updateChecklistItem.mutate({
                              checklistId: section.id,
                              taskIndex: i,
                              completed: !task.completed,
                            }).then(() => {
                              setChecklist(prev => prev.map(s =>
                                s.id !== section.id ? s : {
                                  ...s,
                                  tasks: s.tasks.map((t, j) =>
                                    j !== i ? t : { ...t, completed: !t.completed }
                                  ),
                                }
                              ));
                            }).catch((err: unknown) =>
                              setError(err instanceof Error ? err.message : "Failed to update task")
                            );
                          }}
                        />{" "}
                        {task.description}
                        {task.optional ? " (optional)" : ""}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </dd>
      </dl>
      <p>
        <a href="/schedule">← back to schedule</a>
      </p>
    </div>
  );
}
