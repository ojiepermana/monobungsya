-- Replace the non partitioned log tables from 0002 with yearly range
-- partitioned parents (spec docs/specs/0011-log-subsystem). Parents live
-- in schema "logs"; partition children live in schema "partition", one per
-- Jakarta (UTC+7) calendar year, named <table>_<YYYY>. Composite primary keys
-- (id, <time column>) are required by PostgreSQL range partitioning.

CREATE SCHEMA IF NOT EXISTS "partition";

DROP TABLE IF EXISTS "logs"."audit_trails";

CREATE TABLE "logs"."audit_trails" (
  id uuid NOT NULL DEFAULT uuidv7(),
  action varchar(50) NOT NULL,
  module varchar(50) NOT NULL,
  entity_type varchar(100) NOT NULL,
  entity_id varchar(100) NOT NULL,
  entity_label varchar(150) NULL,
  reference_no varchar(50) NULL,
  transaction_no varchar(50) NULL,
  fiscal_period varchar(20) NULL,
  branch_code varchar(20) NULL,
  amount bigint NULL,
  currency_code varchar(3) NOT NULL DEFAULT 'IDR',
  status_before varchar(30) NULL,
  status_after varchar(30) NULL,
  actor_user_id uuid NULL,
  actor_name varchar(150) NULL,
  actor_email varchar(150) NULL,
  actor_role varchar(50) NULL,
  reason text NULL,
  change_summary text NULL,
  before_state jsonb NULL,
  after_state jsonb NULL,
  metadata jsonb NULL,
  request_id varchar(100) NULL,
  trace_id varchar(100) NULL,
  ip_address varchar(45) NULL,
  user_agent text NULL,
  audited_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT logs_audit_trails_pkey PRIMARY KEY (id, audited_at),
  CONSTRAINT logs_audit_trails_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
) PARTITION BY RANGE (audited_at);

CREATE INDEX logs_audit_trails_module_audited_at_idx
  ON "logs"."audit_trails" (module, audited_at);
CREATE INDEX logs_audit_trails_action_audited_at_idx
  ON "logs"."audit_trails" (action, audited_at);
CREATE INDEX logs_audit_trails_entity_type_entity_id_idx
  ON "logs"."audit_trails" (entity_type, entity_id);
CREATE INDEX logs_audit_trails_reference_no_idx
  ON "logs"."audit_trails" (reference_no);
CREATE INDEX logs_audit_trails_transaction_no_idx
  ON "logs"."audit_trails" (transaction_no);
CREATE INDEX logs_audit_trails_fiscal_period_idx
  ON "logs"."audit_trails" (fiscal_period);
CREATE INDEX logs_audit_trails_branch_code_idx
  ON "logs"."audit_trails" (branch_code);
CREATE INDEX logs_audit_trails_actor_user_id_idx
  ON "logs"."audit_trails" (actor_user_id);
CREATE INDEX logs_audit_trails_request_id_idx
  ON "logs"."audit_trails" (request_id);
CREATE INDEX logs_audit_trails_trace_id_idx
  ON "logs"."audit_trails" (trace_id);

-- Children for the current and next Jakarta calendar year, so inserts have a
-- partition to land in from day one. Later years are created on demand by the
-- shared ensureLogPartition helper.
DO $$
DECLARE
  current_year integer := EXTRACT(
    YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '7 hours'
  )::integer;
  target_year integer;
  parent_name text;
BEGIN
  FOREACH parent_name IN ARRAY ARRAY['audit_trails'] LOOP
    FOR target_year IN current_year..(current_year + 1) LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS "partition".%I PARTITION OF "logs".%I FOR VALUES FROM (%L) TO (%L)',
        parent_name || '_' || target_year,
        parent_name,
        to_char(
          make_timestamp(target_year, 1, 1, 0, 0, 0) - INTERVAL '7 hours',
          'YYYY-MM-DD HH24:MI:SS'
        ),
        to_char(
          make_timestamp(target_year + 1, 1, 1, 0, 0, 0) - INTERVAL '7 hours',
          'YYYY-MM-DD HH24:MI:SS'
        )
      );
    END LOOP;
  END LOOP;
END
$$;

-- Log writers insert through the parents and create yearly children at
-- runtime, which requires owning the parents and CREATE on the child schema.
-- Service runtime roles gain these rights through membership in
-- "project_logs_writer" (provisioned outside migrations, see
-- 0007_database_grants.provisioning.md).
GRANT USAGE, CREATE ON SCHEMA "partition" TO "project_logs_writer";
GRANT USAGE ON SCHEMA "logs" TO "project_logs_writer";
ALTER TABLE "logs"."audit_trails" OWNER TO "project_logs_writer";
