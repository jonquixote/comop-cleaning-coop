import type { Metadata } from "next";

export const metadata: Metadata = { title: "Co-op Cleaning" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "1rem" }}>
        <nav>
          <a href="/book">Book</a> {" | "}
          <a href="/bookings">My Bookings</a> {" | "}
          <a href="/login">Login</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
