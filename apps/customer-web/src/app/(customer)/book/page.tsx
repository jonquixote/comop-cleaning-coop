"use client";
import { useState, type FormEvent } from "react";
import { trpc } from "../../../lib/trpc";

export default function BookPage() {
  const [sqft, setSqft] = useState(1000);
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(1);
  const [addons, setAddons] = useState<("deep_clean" | "inside_fridge" | "inside_oven" | "windows")[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [result, setResult] = useState<{ jobId: string; quotedPriceCents: number } | null>(null);
  const [error, setError] = useState("");

  const ADDON_OPTIONS: { value: "deep_clean" | "inside_fridge" | "inside_oven" | "windows"; label: string }[] = [
    { value: "deep_clean", label: "Deep Clean" },
    { value: "inside_fridge", label: "Inside Fridge" },
    { value: "inside_oven", label: "Inside Oven" },
    { value: "windows", label: "Windows" },
  ];

  function toggleAddon(value: "deep_clean" | "inside_fridge" | "inside_oven" | "windows") {
    setAddons((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    try {
      const res = await trpc.booking.create.mutate({
        sqft,
        bedrooms,
        bathrooms,
        addons,
        scheduledAt: scheduledAt || undefined,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    }
  }

  return (
    <div>
      <h1>Book a Cleaning</h1>
      <form onSubmit={onSubmit}>
        <label>Sq Ft<input type="number" value={sqft} onChange={(e) => setSqft(Number(e.target.value))} min={1} required /></label>
        <label>Bedrooms<input type="number" value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))} min={0} required /></label>
        <label>Bathrooms<input type="number" value={bathrooms} onChange={(e) => setBathrooms(Number(e.target.value))} min={0} required /></label>
        <fieldset>
          <legend>Add-ons</legend>
          {ADDON_OPTIONS.map((opt) => (
            <label key={opt.value}><input type="checkbox" checked={addons.includes(opt.value)} onChange={() => toggleAddon(opt.value)} />{opt.label}</label>
          ))}
        </fieldset>
        <label>Scheduled At<input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
        <button type="submit">Get Quote & Book</button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result && (
        <div style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #ccc" }}>
          <h2>Booking Confirmed</h2>
          <p>Job ID: {result.jobId}</p>
          <p>Price: ${(result.quotedPriceCents / 100).toFixed(2)}</p>
          <a href="/bookings">View My Bookings</a>
        </div>
      )}
    </div>
  );
}
