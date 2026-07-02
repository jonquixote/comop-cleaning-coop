"use client";
import { useState, type FormEvent } from "react";
import { trpc } from "../../../lib/trpc";

export default function RegisterPage() {
  const [coOpSlug, setCoOpSlug] = useState("coop-a");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await trpc.auth.register.mutate({ coOpSlug, email, password });
      localStorage.setItem("token", result.token);
      window.location.href = "/book";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Register</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <label>Co-op<input value={coOpSlug} onChange={(e) => setCoOpSlug(e.target.value)} /></label>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password (8+ chars)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
      <button type="submit">Register</button>
      <p><a href="/login">Already have an account? Login</a></p>
    </form>
  );
}
