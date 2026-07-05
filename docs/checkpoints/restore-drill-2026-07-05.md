# Restore drill — 2026-07-05

**Result:** PASS
**Timestamp (UTC):** 2026-07-05T03:57:10.384Z
**Database:** `comop` @ `localhost`
**Snapshot:** `ops/backup/restore-drill-2026-07-05T03-56-55-230Z.dump`
**Integrity anchor:** job `0f3e3f02-1e63-5e53-be7c-aeefe17e0457` (co_op=00000000-0000-0000-0000-00000000000f status=done)

Procedure: pg_dump (custom) → record anchor → DROP+CREATE database → pg_restore → assert anchor present. The database round-trips through the snapshot; the anchor row survived the drop/restore intact.

Part of the Phase-1 **G1** checkpoint evidence (a passed restore drill, per `phase-2-household-sectors.md` §0 / impl spec §3).
