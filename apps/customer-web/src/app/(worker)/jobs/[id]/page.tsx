"use client";
import { use, useEffect, useState } from "react";
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

// Next.js 16: route params are async — resolve the Promise with React's use().
export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistSection[]>([]);
  const [error, setError] = useState("");
  // Per-section toggle errors, keyed by checklist section id — a failed task update shows
  // under its own section instead of blowing away the whole page (FIX-07).
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      trpc.worker.getJob.query({ jobId: id }),
      trpc.worker.getJobChecklists.query({ jobId: id }),
    ]).then(([j, items]) => {
      setJob(j as JobDetail);
      setChecklist(items as ChecklistSection[]);
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load job"));
  }, [id]);

  if (!job && !error) return <p>Loading…</p>;

  return (
    <div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {job && (
        <>
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
                    {sectionErrors[section.id] && (
                      <p style={{ color: "red", margin: "0.25rem 0", paddingLeft: "1rem" }}>
                        {sectionErrors[section.id]}
                      </p>
                    )}
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
                                  setSectionErrors(prev => {
                                    if (!prev[section.id]) return prev;
                                    const next = { ...prev };
                                    delete next[section.id];
                                    return next;
                                  });
                                  setChecklist(prev => prev.map(s => {
                                    if (s.id !== section.id) return s;
                                    const tasks = s.tasks.map((t, j) =>
                                      j !== i ? t : { ...t, completed: !t.completed }
                                    );
                                    // Mirror the server's rule (worker.updateChecklistItem):
                                    // a section is complete when every non-optional task is done.
                                    const completed = tasks.every((t) => t.optional || !!t.completed);
                                    return { ...s, tasks, completed };
                                  }));
                                }).catch((err: unknown) =>
                                  setSectionErrors(prev => ({
                                    ...prev,
                                    [section.id]: err instanceof Error ? err.message : "Failed to update task",
                                  }))
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
        </>
      )}
      <p>
        <a href="/schedule">← back to schedule</a>
      </p>
    </div>
  );
}
