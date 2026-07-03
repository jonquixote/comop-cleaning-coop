"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../../lib/trpc";

interface ProposalDetail {
  id: string;
  title: string;
  body: string;
  type: string;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  stakesLevel: string;
  transparencySnapshot: unknown;
  createdAt: string;
  tallies: { yes: number; no: number; abstain: number };
}

export default function ProposalDetailPage({ params }: { params: { id: string } }) {
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.governance.getProposal
      .query({ proposalId: params.id })
      .then((p) => setProposal(p as unknown as ProposalDetail))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load proposal"));
  }, [params.id]);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!proposal) return <p>Loading…</p>;

  return (
    <div>
      <h1>{proposal.title}</h1>
      <p>
        <strong>Status:</strong> {proposal.status} · <strong>Stakes:</strong> {proposal.stakesLevel}
      </p>
      <p style={{ whiteSpace: "pre-wrap" }}>{proposal.body}</p>
      <h2>Vote tallies</h2>
      <ul>
        <li>Yes: {proposal.tallies.yes}</li>
        <li>No: {proposal.tallies.no}</li>
        <li>Abstain: {proposal.tallies.abstain}</li>
      </ul>
      {proposal.transparencySnapshot !== null && (
        <details>
          <summary>Attached economic snapshot</summary>
          <pre>{JSON.stringify(proposal.transparencySnapshot, null, 2)}</pre>
        </details>
      )}
      {proposal.status === "open" && (
        <p>
          <a href={`/vote/${proposal.id}`}>Cast your vote →</a>
        </p>
      )}
      <p><a href="/proposals">← all proposals</a></p>
    </div>
  );
}
