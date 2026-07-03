"use client";
import { useState, type FormEvent } from "react";
import { trpc } from "../../../../lib/trpc";

export default function WorkerLoginPage() {
  const [coOpSlug, setCoOpSlug] = useState("coop-a");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await trpc.auth.login.mutate({ coOpSlug, email, password });
      localStorage.setItem("token", result.token);
      window.location.href = "/schedule";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Worker Login</h1>
      <p>Worker-owners are invited — there is no self-register. Ask the co-op admin for an invite token if you don't have one yet.</p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <label>Co-op<input value={coOpSlug} onChange={(e) => setCoOpSlug(e.target.value)} /></label>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <button type="submit">Login</button>
      <p><a href="/login">Customer login</a></p>
    </form>
  );
}
