REVOKE ALL ON FUNCTION "telemetry".ensure_current_partitions() FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".ensure_year_partitions(integer) FROM PUBLIC;
DROP FUNCTION IF EXISTS "telemetry".ensure_current_partitions();
DROP FUNCTION IF EXISTS "telemetry".ensure_year_partitions(integer);

-- Restore regular yearly leaves while preserving rows when this migration is
-- rolled back immediately after it was applied.
DO $$
DECLARE
  parent_name text;
  time_column text;
  child_row record;
  legacy_name text;
BEGIN
  FOREACH parent_name IN ARRAY ARRAY['spans', 'metric_buckets'] LOOP
    time_column := CASE parent_name
      WHEN 'spans' THEN 'started_at'
      ELSE 'bucket_start'
    END;
    FOR child_row IN
      SELECT child.relname AS child_name,
             substring(child.relname FROM '[0-9]{4}$')::integer AS year_value
      FROM pg_inherits AS inheritance
      JOIN pg_class AS child ON child.oid = inheritance.inhrelid
      JOIN pg_class AS parent ON parent.oid = inheritance.inhparent
      JOIN pg_namespace AS namespace ON namespace.oid = parent.relnamespace
      WHERE namespace.nspname = 'telemetry'
        AND parent.relname = parent_name
        AND child.relkind = 'p'
        AND child.relname ~ ('^' || parent_name || '_[0-9]{4}$')
    LOOP
      EXECUTE format(
        'ALTER TABLE "telemetry".%I DETACH PARTITION "telemetry".%I',
        parent_name,
        child_row.child_name
      );
      legacy_name := child_row.child_name || '_daily_legacy_' || txid_current();
      EXECUTE format(
        'ALTER TABLE "telemetry".%I RENAME TO %I',
        child_row.child_name,
        legacy_name
      );
      EXECUTE format(
        'CREATE TABLE "telemetry".%I PARTITION OF "telemetry".%I ' ||
        'FOR VALUES FROM (%L) TO (%L)',
        child_row.child_name,
        parent_name,
        make_date(child_row.year_value, 1, 1),
        make_date(child_row.year_value + 1, 1, 1)
      );
      EXECUTE format(
        'INSERT INTO "telemetry".%I SELECT * FROM "telemetry".%I',
        parent_name,
        legacy_name
      );
      EXECUTE format('DROP TABLE "telemetry".%I CASCADE', legacy_name);
    END LOOP;
  END LOOP;
END
$$;
