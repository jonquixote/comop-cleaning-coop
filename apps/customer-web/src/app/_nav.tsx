"use client";
import { useEffect, useState } from "react";

export function Nav() {
  const [token, setToken] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setToken(typeof window !== "undefined" ? localStorage.getItem("token") : null);
  }, []);

  function logout() {
    if (typeof window !== "undefined") localStorage.removeItem("token");
    window.location.href = "/login";
  }

  // Render a stable nav during SSR — we deliberately do not gate links on the
  // token shape (we don't know the role) so we show both sets when the user IS
  // signed in and only the basic links when not.
  return (
    <nav>
      <a href="/book">Book</a> {" | "}
      <a href="/bookings">My Bookings</a> {" | "}
      {mounted && token ? (
        <>
          {" | "}
          <a href="/schedule">Worker</a>
          {" | "}
          <button type="button" onClick={logout} style={{ background: "transparent", border: "none", color: "blue", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
            Logout
          </button>
        </>
      ) : (
        <>
          {" | "}
          <a href="/login">Login</a>
          {" | "}
          <a href="/login/worker">Worker login</a>
        </>
      )}
    </nav>
  );
}
