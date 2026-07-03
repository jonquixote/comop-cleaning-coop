"use client";
import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

interface PeriodHealth {
  periodId: string | null;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  totalRevenueCents: number;
  totalExpensesCents: number;
  fixedCostsCents: number;
  laborCents: number;
  surplusCents: number;
  currentSurplusSplit: number;
  breakEvenRevenueCents: number;
  status: "on_track" | "below_break_even" | "deficit";
  statusReason: string;
}

const c = (n: number) => `$${(n / 100).toFixed(2)}`;

const statusColor: Record<PeriodHealth["status"], string> = {
  on_track: "#14853a",
  below_break_even: "#b88600",
  deficit: "#b22222",
};

export default function HealthPage() {
  const [data, setData] = useState<PeriodHealth | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.transparency.periodHealth
      .query()
      .then((d) => setData(d as PeriodHealth))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load health"));
  }, []);

  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <div>
      <h1>Period Health</h1>
      {data.periodId === null ? (
        <p style={{ color: "#666" }}>
          No open allocation period. Open one to begin tracking period h ealth.
        </p>
      ) : (
        <>
          <p>
            Period:{" "}
            <code>
              {data.periodStartsAt} → {data.periodEndsAt}
            </code>
          </p>
          <p style={{ color: statusColor[data.status], fontWeight: "bold" }}>
            {data.status === "on_track"
              ? "On track"
              : data.status === "below_break_even"
                ? "At break-even"
                : "Deficit"}{" "}
            — {data.statusReason}
          </p>
          <table>
            <tbody>
              <tr><th>Total revenue (this period)</th><td>{c(data.totalRevenueCents)}</td></tr>
              <tr><th>Total expenses</th><td>{c(data.totalExpensesCents)}</td></tr>
              <tr><th>Labor booked</th><td>{c(data.laborCents)}</td></tr>
              <tr><th>Surplus</th><td>{c(data.surplusCents)}</td></tr>
              <tr><th>Break-even revenue</th><td>{c(data.breakEvenRevenueCents)}</td></tr>
              <tr>
                <th>Margin to break-even</th>
                <td>
                  {c(data.totalRevenueCents - data.breakEvenRevenueCents)} ({data.status})
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Break-even = total expenses. surplusSplit (currently {Math.round(data.currentSurplusSplit * 100)}%) only changes
            worker take-home per unit of surplus — it does not move the break-even line.
          </p>
        </>
      )}
      <p><a href="/transparency">← back to transparency</a></p>
    </div>
  );
}
