"use client";
import { useState, useEffect } from "react";
import { trpc } from "../../../lib/trpc";

interface Booking {
  jobId: string;
  status: string;
  quotedPriceCents: number;
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  addons: string[];
  scheduledAt: string | null;
  createdAt: string;
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.booking.list
      .query()
      .then(setBookings)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load bookings"));
  }, []);

  if (error) return <p style={{ color: "red" }}>{error}</p>;

  if (bookings.length === 0) return <p>No bookings yet. <a href="/book">Book a cleaning</a></p>;

  return (
    <div>
      <h1>My Bookings</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Job ID</th><th>Status</th><th>Price</th><th>Details</th><th>Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.jobId}>
              <td>{b.jobId.slice(0, 8)}...</td>
              <td>{b.status}</td>
              <td>${(b.quotedPriceCents / 100).toFixed(2)}</td>
              <td>{b.sqft}sqft, {b.bedrooms}bd/{b.bathrooms}ba{b.addons.length ? ` +${b.addons.join(", ")}` : ""}</td>
              <td>{b.scheduledAt ? new Date(b.scheduledAt).toLocaleDateString() : "TBD"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
