# ADR-0006: Production Postgres runs as a native apt/systemd service, not in a container

- **Status:** Accepted
- **Date:** 2026-06-30
- **Context:** ADR-0004 confirmed self-hosted PostgreSQL on a VPS (no managed platform). The remaining open question is *how* that Postgres process runs in production: inside Docker (as the current `docker-compose.yml` dev stack does) or as a native OS service. The choice has concrete implications for I/O path, backup tooling integration, and long-term maintainability.

## Decision

Production Postgres runs as a **native apt install managed by systemd** — not in a Docker container. Concretely: use the distro-packaged `postgresql@16.service` unit file provided by the `postgresql-16` apt package. Do **not** write a custom systemd unit from scratch; the distro-packaged unit already sets `RemoveIPC=no` (required for Postgres shared memory cleanup) and is maintained by the distribution.

`docker-compose.yml` is retained for two purposes only:
1. **Local development** — the `postgres` service gives engineers a one-command local stack without touching the host OS.
2. **Restore-drill scratch instance** — the `postgres_scratch` service (started with `--profile scratch`) provides an isolated target for automated restore drills, keeping them off the working development DB.

Docker is explicitly **not** the production database process.

## Rationale

1. **Direct I/O.** A native Postgres process accesses the filesystem directly; a containerised Postgres adds a union-filesystem layer (even with a bind-mount or named volume) that can degrade fsync latency and makes performance profiling harder to reason about at the kernel level.

2. **pgBackRest native integration.** pgBackRest is designed to run on the same host as the Postgres data directory. A native install means pgBackRest can reach `PGDATA`, the WAL directory, and the Postgres Unix socket without volume-indirection wiring. Container volumes introduce an extra mapping layer that complicates stanza configuration, socket paths, and in-place restore (`pgbackrest restore` into the real `PGDATA` requires the process to stop — straightforward under systemd, fiddly under compose).

3. **No Docker minor-version upgrade traps.** A production container image must be pinned by digest (engineering standard §7). Every time a `postgres:16.x-alpine` patch is released, the digest must be manually updated, a new image pulled, and the container restarted — a small but recurring ops surface. The distro apt package updates through the normal `apt-get upgrade` path with the same version pinning guarantees and is the model the distribution's security team maintains.

4. **systemd is already the process supervisor.** The VPS runs systemd. Using it for Postgres keeps the supervision model uniform (one tool for service lifecycle, journald for logs, `systemctl status` for health). Running a container adds a second supervisor layer (Docker daemon) without adding capability.

## Consequences

- **Ops runbook** (`ops/runbook.md`) must document starting/stopping/restarting Postgres with `systemctl` commands against `postgresql@16.service`, not `docker compose`.
- **pgBackRest configuration** (`ops/backup/pgbackrest.conf`, when added) targets the native `PGDATA` path (typically `/var/lib/postgresql/16/main` on Debian/Ubuntu) and the Unix socket at `/var/run/postgresql`.
- **`docker-compose.yml`** remains in the repo and in active use for local dev and the restore-drill scratch target — it is not removed. Its header comment must make the local-dev-only scope explicit (updated in this PR).
- **Engineer onboarding** must not leave the impression that `docker compose up` boots the production database. The onboarding runbook is updated in this PR to add a callout box.
- The distro-packaged `postgresql@16.service` unit is used as-is; `RemoveIPC=no` is already set — no custom unit needed.
