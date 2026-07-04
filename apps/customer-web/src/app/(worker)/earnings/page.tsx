"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

interface WorkerEarnings {
  allocations: Array<{
    allocationId: string;
    periodId: string;
    periodStart: string;
    periodEnd: string;
    amountCents: number;
    laborBasis: number;
  }>;
  capitalBalanceCents: number;
  currentSurplusSplit: number;
  policyVersionId: string;
}

export default function EarningsPage() {
  const [data, setData] = useState<WorkerEarnings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.transparency.workerEarnings
      .query()
      .then((d) => setData(d as WorkerEarnings))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load earnings"));
  }, []);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!data) return <p>Loading…</p>;

  const c = (n: number) => `$${(n / 100).toFixed(2)}`;

  return (
    <div>
      <h1>Earnings</h1>
      <section>
        <h2>Capital account(patronage)</h2>
        <p>Balance: <strong>{c(data.capitalBalanceCents)}</strong></p>
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          Tax-conformant patronage treatment requires bylaws + CPA sign-off (see ADR/spec §9). Do not rely on this for filings until confirmed.
        </p>
      </section>
      <section>
        <h2>Current surplus split</h2>
        <p>{Math.round(data.currentSurplusSplit * 100)}% to worker-owners · {Math.round((1 - data.currentSurplusSplit) * 100)}% retained as customer-price margin</p>
      </section>
      <section>
        <h2>Allocations(closed periods)</h2>
        {data.allocations.length === 0 ? (
          <p>No closed periods yet. Watch the transparency tab for settled periods.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Closed period</th>
                <th>Labor basis (hours)</th>
                <th>Allocation</th>
              </tr>
            </thead>
            <tbody>
              {data.allocations.map((a) => (
                <tr key={a.allocationId}>
                  <td>{new Date(a.periodEnd).toLocaleDateString()}</td>
                  <td>{a.laborBasis.toFixed(2)}</td>
                  <td>{c(a.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p><a href="/transparency">See co-op transparency →</a></p>
    </div>
  );
}
