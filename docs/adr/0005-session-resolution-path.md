# ADR-0005: Session resolution is a capability-token lookup, the one pre-tenant read

- **Status:** Accepted
- **Date:** 2026-06-29 (N=1, Phase 1 Task 6)
- **Context:** The auth→RLS chain (ADR-0004 §3, impl §3a) resolves `co_op_id` from the trusted session *before* any tenant context is set. But under default-deny RLS the runtime role (`app_user`) cannot read a `sessions` row without already knowing the tenant — the session is *how* the tenant is learned. This chicken-and-egg must be resolved deliberately; it alters the trust chain, so it gets an ADR (std §4).

## Decision
- The opaque session token is a high-entropy random secret (32 bytes). Only its **sha256 `token_hash`** is stored; the raw token is the bearer credential and is never persisted.
- `sessions` carries a **second, permissive `FOR SELECT` policy** `session_by_token`, OR-ed with the existing tenant-scoped `tenant_isolation`:
  ```sql
  USING (token_hash = nullif(current_setting('app.session_token_hash', true), ''))
  ```
  The resolver sets `app.session_token_hash` (transaction-scoped) to the presented token's hash and selects — returning **only the single row whose hash it already holds**. No `app.current_co_op` is set during resolution.
- **Presenting the token IS the authorization.** A caller can only set the GUC to a hash it computed from a token it holds; hashes are sha256 of 256-bit secrets, so rows cannot be enumerated or guessed. The policy exposes exactly one row and only to whoever holds its token.
- Resolution returns the minimal `{ sessionId, userId, coOpId }`. Everything afterward runs through the normal `withTenantTx(coOpId, …)` path (`withSessionTx`, the sole app door). `role` is read *after* tenant context is set, from `users`.
- **Writes stay tenant-scoped.** `create`/`revoke` happen when the tenant is already known and go through `withTenantTx` under `tenant_isolation` (the `session_by_token` policy is `SELECT`-only). `sessions` therefore keeps `FORCE` RLS — no owner-bypass path is introduced.

## Consequences
- The only cross-tenant-capable read is this narrow, capability-gated lookup returning minimal fields for a **valid** (matching hash, not expired, not revoked) session — consistent with ADR-0002's "audited, narrow path," without granting `app_user` broad cross-tenant access or `BYPASSRLS`.
- In normal tenant operations the GUC is unset → `nullif(…,'')` is NULL → `token_hash = NULL` matches nothing → the policy adds zero exposure.
- Revocation is immediate: `resolveSession` reads `revoked_at`/`expires_at` live, so a revoked token fails the door on the very next request (impl §3a.1).
- Invitation / magic-link issuance (impl §3a.1) are login-flow UX built on these same primitives; they are scaffolded in the auth-flow slice, not the foundation. The load-bearing piece — the session-resolved `withSessionTx` door — is complete here.
