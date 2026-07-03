// Root layout. Render server-side; nav is a client component to read localStorage
// at hydration time so we can show/hide the worker menu based on the session.
import type { Metadata } from "next";
import { Nav } from "./_nav";

export const metadata: Metadata = { title: "Co-op Cleaning" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "1rem" }}>
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  );
}
