"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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

export default function VotePage({ params }: { params: { id: string } }) {
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    trpc.governance.getProposal
      .query({ proposalId: params.id })
      .then((p) => setProposal(p as unknown as ProposalDetail))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load proposal"));
  }, [params.id]);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!proposal) return <p>Loading…</p>;

  async function vote(choice: "yes" | "no" | "abstain") {
    setSubmitting(true);
    setError("");
    try {
      await trpc.governance.castVote.mutate({ proposalId: proposal!.id, choice });
      setDone(choice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to vote");
    } finally {
      setSubmitting(false);
    }
  }

  if (proposal.status !== "open") {
    return (
      <div>
        <h1>Vote: {proposal.title}</h1>
        <p>This proposal is not open for voting (status: {proposal.status}).</p>
        <p><a href={`/proposals/${proposal.id}`}>← back to proposal</a></p>
      </div>
    );
  }

  return (
    <div>
      <h1>Vote: {proposal.title}</h1>
      <p style={{ whiteSpace: "pre-wrap" }}>{proposal.body}</p>
      {done ? (
        <p>Your vote (“{done}”) has been recorded.</p>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
          }}
        >
          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <button type="button" onClick={() => vote("yes")} disabled={submitting}>
              Yes
            </button>
            <button type="button" onClick={() => vote("no")} disabled={submitting}>
              No
            </button>
            <button type="button" onClick={() => vote("abstain")} disabled={submitting}>
              Abstain
            </button>
          </div>
        </form>
      )}
      {error && <p style={{ color: "red" }}>{error}</p>}
      <p>
        <a href={`/proposals/${proposal.id}`}>← back to proposal</a>
      </p>
    </div>
  );
}
