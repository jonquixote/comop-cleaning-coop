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
On a bare box: `docker compose up` (or native Postgres) → `ops/bootstrap.sh` (db + roles + extensions) → `pnpm tsx ops/migrations/run.ts` (schema) → `restore-drill.sh` path to load data. Tested end-to-end before launch.

## Cert / key rotation
- **`BACKUP_PASS`:** rotate by taking a fresh backup under the new pass; keep the old pass until all backups encrypted under it age out of retention (else old backups become undecryptable).
- **TLS / Postgres certs:** rotate on the host; restart Postgres; verify app reconnects. (Expand when TLS terminates at the app.)

## Failover (deferred until downtime cost justifies it — impl §3.5)
A streaming replica for failover; schema/ops do not preclude it. Until then, recovery = restore latest off-site backup per above (RTO ≤ 1 hour).
