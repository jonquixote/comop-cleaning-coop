"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

interface ProposalRow {
  id: string;
  title: string;
  body: string;
  type: string;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  stakesLevel: string;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  draft: "#666",
  open: "#14853a",
  passed: "#1a5fb4",
  failed: "#b22222",
  withdrawn: "#888",
};

export default function ProposalsPage() {
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.governance.listProposals
      .query()
      .then((r) => setRows(r as ProposalRow[]))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load proposals"));
  }, []);

  if (error) return <p style={{ color: "red" }}>{error}</p>;

  return (
    <div>
      <h1>Proposals</h1>
      {rows.length === 0 ? (
        <p>No proposals yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Stakes</th>
              <th>Status</th>
              <th>Opened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.type}</td>
                <td>{p.stakesLevel}</td>
                <td style={{ color: statusColor[p.status] ?? "#000" }}>{p.status}</td>
                <td>{p.opensAt ? new Date(p.opensAt).toLocaleString() : "—"}</td>
                <td><a href={`/proposals/${p.id}`}>View</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
