# Operations Runbook — Cleaning Co-op Platform

> Operable by a non-specialist following steps (impl §3.4). The discipline that makes this
> a monument: **an untested backup is a hope, not a backup** — the restore drill is run on a
> schedule, and a failed *or skipped* drill pages a human.

## Paging posture (std §7)
- **Page now (respond immediately):** payment path failing · tenant-context/RLS error · production down · **restore drill failed**.
- **Next business day:** non-critical sync retries · dependency advisories · capacity warnings.
- **On-call:** set `PAGE_CHANNEL` (e.g. `#comop-oncall` + the named on-call engineer). The drill script writes a `PAGE on-call (...)` line and exits non-zero so CI/cron escalates it. "Pages a human" without a name is a page into the void.

## Backups — what runs
- **Floor (live now):** `ops/backup/backup.sh` — encrypted (`aes-256-cbc`, pbkdf2) logical dump pushed **off-box** to `OFFSITE_REPO`. `OFFSITE_REPO` is a filesystem repo locally, or `rclone:b2:<bucket>` / `s3://<bucket>` for real off-site (Backblaze B2 / Hetzner Storage Box). Retains 30 locally; remotes use lifecycle rules.
  - `pg_dump` runs as **superuser** by design — `app_owner` is subject to `FORCE` RLS and would dump zero tenant rows.
- **Production primary (deferred, staging allowance):** pgBackRest **physical** backups + continuous WAL archiving (PITR, RPO ≤ 5 min). Physical backups are RLS-agnostic. Add `ops/backup/pgbackrest.conf` and switch `backup.sh`→pgBackRest once staged; **do not** drop the off-site+restore floor in the meantime.
- **Roles/globals:** logical restore to a *bare* box also needs cluster roles — capture with `pg_dumpall --globals-only` (app_owner/app_user). On the same cluster the roles already exist.

## Restore drill — the procedure (`ops/backup/restore-drill.sh`)
Run nightly + pre-release (and by hand in your first week). Steps the script performs:
1. Find the **latest** `*.dump.enc` in `OFFSITE_REPO`. **None found → page (skipped == failed).**
2. Pull it, **decrypt** with `BACKUP_PASS`. Decrypt failure → page.
3. Create a **fresh scratch DB** (`SCRATCH_DB_NAME`, default `comop_scratch`) — **never the working DB** — and `pg_restore` into it.
4. **Verify:** row-count sanity as superuser (`verify-suite.sql`) **and** RLS-still-isolates as `app_user` (`verify-rls.sql`, tenant context = co-op A). Either failing → page.
5. Drop the scratch DB. Print `restore drill PASSED`.

### Real recovery (production)
Same as the drill but restore into the **real** target (a new primary), then re-point the app's `APP_DATABASE_URL`/`OWNER_DATABASE_URL`. With pgBackRest: `pgbackrest --stanza=comop restore` + replay WAL to the target time, then start Postgres.

## Reproducible rebuild (impl §3.6)
On a bare box: `docker compose up` (local dev only — see ADR-0006) or start the native systemd service → `ops/bootstrap.sh` (db + roles + extensions) → `pnpm tsx ops/migrations/run.ts` (schema) → `restore-drill.sh` path to load data. Tested end-to-end before launch.

**Production Postgres is a native systemd service.** Use the distro-packaged unit (`postgresql@16.service`); do not write a custom unit — the packaged one already sets `RemoveIPC=no`. Manage with `systemctl start|stop|restart postgresql@16` on the production host. `docker compose up` is for local dev and the restore-drill scratch instance only.

## Cert / key rotation
- **`BACKUP_PASS`:** rotate by taking a fresh backup under the new pass; keep the old pass until all backups encrypted under it age out of retention (else old backups become undecryptable).
- **TLS / Postgres certs:** rotate on the host; restart Postgres; verify app reconnects. (Expand when TLS terminates at the app.)

## Stripe webhooks — payment capture (ADR-0012)
- **Endpoint:** `POST /api/webhook` (`apps/customer-web/src/app/api/webhook/route.ts`). Verifies the Stripe signature over the raw body, then captures via `capturePayment`. Payment-path failures **page now** (see posture above).
- **Config:** `STRIPE_WEBHOOK_SECRET` (`whsec_…`) is **required** — if unset, the endpoint rejects every delivery (400, fail closed). Get it from:
  - local/test: `stripe listen --forward-to localhost:3000/api/webhook` prints the `whsec_…`;
  - staging/prod: the Stripe **dashboard** webhook endpoint (Developers → Webhooks). Register the deployed URL, subscribe to `payment_intent.succeeded`, copy the signing secret into the environment.
- **`STRIPE_SECRET_KEY`:** `sk_test_…` in test/staging, `sk_live_…` in prod. Never commit; rotate any key exposed in chat/PR/logs (Stripe dashboard → API keys → roll). Test and live keys are separate — a test key cannot touch real money.
- **Expected responses (for triage):** `400` = bad/absent signature or secret unconfigured (delivery rejected). `200` = handled, duplicate no-op, unhandled event type, or a job not yet `done` (logged, not transitioned — Stripe stops retrying). `500` = unexpected/transient (e.g. DB down) — Stripe retries; investigate.
- **Duplicate deliveries are safe:** idempotency is enforced by `webhook_events` UNIQUE(stripe_event_id) inside `capturePayment` — a replay is a no-op, never a double-charge.
- **If payments aren't capturing:** check the Stripe dashboard webhook delivery log (response codes), confirm `STRIPE_WEBHOOK_SECRET` matches the registered endpoint, and grep app logs for `webhook:` lines. A run of `400`s usually means a secret mismatch after a redeploy.

## Failover (deferred until downtime cost justifies it — impl §3.5)
A streaming replica for failover; schema/ops do not preclude it. Until then, recovery = restore latest off-site backup per above (RTO ≤ 1 hour).
