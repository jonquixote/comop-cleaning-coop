"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

interface Transparency {
  totalRevenueCents: number;
  laborCents: number;
  materialsCents: number;
  overheadCents: number;
  surplusPoolCents: number;
  currentSurplusSplit: number;
  policyVersionId: string;
}

const c = (n: number) => `$${(n / 100).toFixed(2)}`;

export default function TransparencyPage() {
  const [data, setData] = useState<Transparency | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.transparency.periodTransparency
      .query()
      .then((d) => setData(d as Transparency))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load transparency"));
  }, []);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!data) return <p>Loading…</p>;

  const workerShareCents = Math.max(0, data.surplusPoolCents * data.currentSurplusSplit);

  return (
    <div>
      <h1>Co-op Transparency</h1>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        Every dollar accounted for. Honest numbers, all sides — info rms, not persuades.
      </p>
      <table>
        <tbody>
          <tr><th>Total revenue (paid jobs)</th><td>{c(data.totalRevenueCents)}</td></tr>
          <tr><th>Labor</th><td>{c(data.laborCents)}</td></tr>
          <tr><th>Materials</th><td>{c(data.materialsCents)}</td></tr>
          <tr><th>Overhead (allocated)</th><td>{c(data.overheadCents)}</td></tr>
          <tr><th>Surplus pool</th><td>{c(data.surplusPoolCents)}</td></tr>
          <tr><th>Current surplus split</th><td>{Math.round(data.currentSurplusSplit * 100)}% to workers</td></tr>
          <tr><th>Worker share of surplus pool</th><td>{c(Math.round(workerShareCents))}</td></tr>
        </tbody>
      </table>
      <p>
        Policy version: <code>{data.policyVersionId.slice(0, 8)}</code>
      </p>
      <p><a href="/health">See period health / break-even →</a></p>
      <p><a href="/proposals">See open proposals →</a></p>
    </div>
  );
}
