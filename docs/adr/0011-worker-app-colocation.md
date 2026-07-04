# ADR-0011: Worker app — colocate with customer-web (route group, shared Next.js)

- **Status:** Accepted
- **Date:** 2026-07-02 (Phase 1 check-in)
- **Context:** A worker-owner surface is required by the spec (§6 Mission tenets 2 + 3, §7 step 7/8 governance, §6 period-health/break-even). It needs auth, tRPC procedures over the same `withSessionTx` chain as the customer app, and access to the same React/Next.js toolchain. The choice was: a separate `apps/worker` Next.js process, or a route group colocated inside `apps/customer-web`.

## Decision

**Use a route group inside the existing `apps/customer-web` Next.js app.** The worker surface lives under `apps/customer-web/src/app/(worker)/` alongside `(auth)/` and `(customer)/`. The two surfaces share one server, one tRPC root, one build, one deploy.

## Why not a separate process

A separate `apps/worker` Next.js app would require:

- a second `next.config.ts` / `tsconfig.json` / `package.json`;
- a second dev port; second `pnpm build` pipeline; second deploy target;
- a second `fetchRequestHandler` adapter and a second tRPC root.

For a single-co-op MVP at N=1 worker-owner, the overhead is real and the benefit is zero. The two surfaces talk to the **same** Postgres (the only place they share anything substantive), and Next.js already gives us a clean way to separate *logical surfaces* (route groups) without paying the cost of a *separate process*.

`apps/worker` (the placeholder package) is left in place for the future moment when the worker app diverges (its own session-UX, native push, offline state — none of those are in scope for MVP).

## Why a route group, not a sibling app on the same server

`apps/customer-web/src/app/(worker)/…` gives us an authoritative single entrypoint and a single build artefact. URL routing (`/schedule`, `/earnings`, `/vote/[id]`) coexists with `/book` and `/bookings`. The auth-aware nav at `/` looks at `localStorage.token` and shows either customer or worker links. `(auth)/login/worker` is a separate login page that calls the existing `auth.login` procedure and redirects to `/schedule` — same backend, worker-targeted UX.

## Consequences

- **Single source of truth for tRPC types.** Worker procedures (`worker.*`, `transparency.*`, `governance.*`, `invites.*`) are added to `apps/customer-web/src/server/routers/` and merged in the same `appRouter`. The worker app does not redeclare them — it imports `AppRouter` from the same module.
- **Promotion criteria are explicit.** A future ADR will move the worker out only when one of these holds: a separate build pipeline is needed (different Node version, different Dockerfile), or we want to ship worker-pwa as a fully decoupled native shell.
- **The boundary check stays green.** No `/platform → /sectors` imports were added; the worker route group lives under `/apps`, which is downstream of `/platform` and `/sectors` (per ADR-0003).
- **`apps/worker` directory stays as the long-term home marker.** It carries the index export so future code references resolve, but no Next.js app lives there yet.

## Revisit later

When the worker experience grows to deserve its own pipeline (per-surface analytics, push notifications, an offline-first PWA), the route group can be moved into its own package and a new ADR written. Today is too early to pay that bill.
