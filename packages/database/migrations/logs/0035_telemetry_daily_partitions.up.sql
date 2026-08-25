-- Convert the yearly telemetry leaves into daily subpartitions without
-- changing the public parent tables used by writers and readers.
DO $$
DECLARE
  parent_name text;
  time_column text;
  child_row record;
  legacy_name text;
  day_value date;
  year_end date;
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
        AND child.relname ~ ('^' || parent_name || '_[0-9]{4}$')
    LOOP
      EXECUTE format(
        'ALTER TABLE "telemetry".%I DETACH PARTITION "telemetry".%I',
        parent_name,
        child_row.child_name
      );

      legacy_name := child_row.child_name || '_legacy_' || txid_current();
      EXECUTE format(
        'ALTER TABLE "telemetry".%I RENAME TO %I',
        child_row.child_name,
        legacy_name
      );
      EXECUTE format(
        'CREATE TABLE "telemetry".%I PARTITION OF "telemetry".%I ' ||
        'FOR VALUES FROM (%L) TO (%L) PARTITION BY RANGE (%I)',
        child_row.child_name,
        parent_name,
        make_date(child_row.year_value, 1, 1),
        make_date(child_row.year_value + 1, 1, 1),
        time_column
      );

      day_value := make_date(child_row.year_value, 1, 1);
      year_end := make_date(child_row.year_value + 1, 1, 1);
      WHILE day_value < year_end LOOP
        EXECUTE format(
          'CREATE TABLE "telemetry".%I PARTITION OF "telemetry".%I ' ||
          'FOR VALUES FROM (%L) TO (%L)',
          child_row.child_name || '_' || to_char(day_value, 'YYYY_MM_DD'),
          child_row.child_name,
          day_value,
          day_value + 1
        );
        day_value := day_value + 1;
      END LOOP;

      EXECUTE format(
        'INSERT INTO "telemetry".%I SELECT * FROM "telemetry".%I',
        parent_name,
        legacy_name
      );
      EXECUTE format('DROP TABLE "telemetry".%I', legacy_name);
    END LOOP;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION "telemetry".ensure_year_partitions(
  p_year integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, telemetry
AS $$
DECLARE
  parent_name text;
  time_column text;
  child_name text;
  day_value date;
  year_end date;
BEGIN
  IF p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'telemetry partition year is outside the supported range';
  END IF;

  FOREACH parent_name IN ARRAY ARRAY['spans', 'metric_buckets'] LOOP
    time_column := CASE parent_name
      WHEN 'spans' THEN 'started_at'
      ELSE 'bucket_start'
    END;
    child_name := parent_name || '_' || p_year;
    IF to_regclass(format('telemetry.%I', child_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE "telemetry".%I PARTITION OF "telemetry".%I ' ||
        'FOR VALUES FROM (%L) TO (%L) PARTITION BY RANGE (%I)',
        child_name,
        parent_name,
        make_date(p_year, 1, 1),
        make_date(p_year + 1, 1, 1),
        time_column
      );
    END IF;

    day_value := make_date(p_year, 1, 1);
    year_end := make_date(p_year + 1, 1, 1);
    WHILE day_value < year_end LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS "telemetry".%I PARTITION OF "telemetry".%I ' ||
        'FOR VALUES FROM (%L) TO (%L)',
        child_name || '_' || to_char(day_value, 'YYYY_MM_DD'),
        child_name,
        day_value,
        day_value + 1
      );
      day_value := day_value + 1;
    END LOOP;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION "telemetry".ensure_current_partitions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, telemetry
AS $$
  SELECT "telemetry".ensure_year_partitions(
    EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer
  );
  SELECT "telemetry".ensure_year_partitions(
    EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer + 1
  );
$$;

REVOKE ALL ON FUNCTION "telemetry".ensure_year_partitions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "telemetry".ensure_current_partitions() FROM PUBLIC;

DO $$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'project_jobs_runtime'::name,
    'project_telemetry_writer'::name
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION "telemetry".ensure_year_partitions(integer) TO %I',
        role_name
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION "telemetry".ensure_current_partitions() TO %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
