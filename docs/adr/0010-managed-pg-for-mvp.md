# ADR-0010: Managed PostgreSQL for MVP (UpCloud)

- **Status:** Accepted
- **Date:** 2026-07-01
- **Context:** ADR-0004 and ADR-0006 prescribed self-hosted PostgreSQL as a native apt/systemd service on the production VPS. During provisioning it became clear that the operational burden of self-hosting — automated backups with PITR (pgBackRest), monitoring, failover, and minor-version patching — exceeded the MVP team's capacity without a dedicated SRE rotation. A managed PostgreSQL service (UpCloud Managed Database, backed by Aiven) was evaluated as a drop-in replacement that preserves the app-level RLS and `app_owner`/`app_user` security model.

## Decision

Use **UpCloud Managed Database for PostgreSQL 16** (Aiven-powered) for the MVP production database. The VPS (209.50.61.212) retains a local postgresql-client-18 install for `psql`/`pg_dump`/`pg_restore` tooling and serves as the backup/restore-drill host, but the primary database lives on the managed service.

Concretely:
- The three roles (`upadmin` superuser, `app_owner`, `app_user`) are provisioned by UpCloud/Aiven on cluster creation.
- The app, migrations, and seed connect over TLS to the Aiven hostname (`comop-prod-*.db.upclouddatabases.com:11569`).
- The `comop` database uses the Aiven-provided Project CA (self-signed, per-service issuance) — SSL is verified-full with `PGSSLROOTCERT` for libpq and `NODE_EXTRA_CA_CERTS` for Node.js.
- Backups are encrypted logical dumps (`pg_dump -Fc` → `aes-256-cbc`) pushed off-host to Backblaze B2 via rclone, with daily restore drills that verify row counts and RLS isolation on a scratch database on the same managed cluster.
- Physical PITR (pgBackRest) is deferred; the logical backup + drill floor satisfies the current RPO/RTO requirements for MVP.

## Rationale

1. **Operational leverage.** Managed Postgres eliminates pgBackRest setup, WAL archive configuration, failover engineering, and minor-version upgrade scheduling. The team focuses on the app.
2. **TLS built in.** The managed service enforces TLS on all connections, which tightens the default security posture vs. a self-hosted instance where TLS is opt-in and cert rotation is manual.
3. **Same security model.** The app still connects as `app_user` (non-superuser, no `BYPASSRLS`). The RLS fail-closed invariant is unchanged. Managed Postgres does not weaken the tenant-isolation guarantee.
4. **Backup parity.** The encrypted off-site + restore-drill workflow works identically against the managed cluster. The scratch DB for the drill lives on the same cluster — no infrastructure change needed.

## Consequences

- **ADR-0006 is partially superseded.** The production Postgres process is no longer the native systemd service on the VPS. That VPS still exists and runs `postgresql-client-18` for tooling, but `postgresql@16.service` is not started. ADR-0006's rationale about direct I/O and pgBackRest integration is deferred until a future scale-up.
- **ADR-0004's "self-hosted" clause is amended.** The app-layer security model (non-superuser roles, RLS, no `BYPASSRLS`) is unchanged; only the hosting surface changes.
- **Network dependency.** The app now requires a working egress path to `*.db.upclouddatabases.com:11569`. During an outage of the managed service the app cannot function. The backup drill is also dependent on that egress path — if the scratch DB cannot be created on the remote cluster the drill fails (which is the correct page behavior).
- **Cost.** Managed Postgres adds a monthly line item that a self-hosted instance would not.
- **Migration path.** If self-hosting becomes necessary later, the encrypted off-site backups are portable: `pg_restore` into any PostgreSQL 16 cluster. The restore drill proves this works.
