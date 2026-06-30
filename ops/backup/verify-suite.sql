-- Post-restore verification (run as SUPERUSER on the scratch DB — sees all rows).
-- Row-count sanity: the seed guarantees >= 2 of each. Migrations must all be present.
DO $$
BEGIN
  IF (SELECT count(*) FROM co_ops)            < 2 THEN RAISE EXCEPTION 'verify: expected >= 2 co_ops';   END IF;
  IF (SELECT count(*) FROM users)             < 2 THEN RAISE EXCEPTION 'verify: expected >= 2 users';    END IF;
  IF (SELECT count(*) FROM members)           < 2 THEN RAISE EXCEPTION 'verify: expected >= 2 members';  END IF;
  IF (SELECT count(*) FROM schema_migrations) < 4 THEN RAISE EXCEPTION 'verify: migrations missing';     END IF;
END $$;
SELECT 'verify-suite OK: '
  || (SELECT count(*) FROM co_ops)  || ' co_ops, '
  || (SELECT count(*) FROM members) || ' members, '
  || (SELECT count(*) FROM schema_migrations) || ' migrations' AS result;
