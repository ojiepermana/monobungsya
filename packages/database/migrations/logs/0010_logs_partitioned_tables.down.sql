-- Drop the partitioned parents (children in schema "partition" drop with
-- them) and restore the non partitioned tables exactly as 0002 created them.

DROP TABLE IF EXISTS "logs"."logging";
DROP TABLE IF EXISTS "logs"."audit_trails";
DROP TABLE IF EXISTS "logs"."access_logs";
DROP SCHEMA IF EXISTS "partition" CASCADE;

CREATE TABLE IF NOT EXISTS "logs"."logging" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  level varchar(20) NOT NULL,
  category varchar(50) NOT NULL DEFAULT 'application',
  event varchar(100) NULL,
  module varchar(50) NULL,
  message text NOT NULL,
  context jsonb NULL,
  actor_user_id uuid NULL,
  entity_type varchar(100) NULL,
  entity_id varchar(100) NULL,
  request_id varchar(100) NULL,
  trace_id varchar(100) NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logs_logging_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE TABLE IF NOT EXISTS "logs"."audit_trails" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  action varchar(50) NOT NULL,
  module varchar(50) NOT NULL,
  entity_type varchar(100) NOT NULL,
  entity_id varchar(100) NOT NULL,
  actor_user_id uuid NULL,
  before_state jsonb NULL,
  after_state jsonb NULL,
  metadata jsonb NULL,
  audited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logs_audit_trails_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE TABLE IF NOT EXISTS "logs"."access_logs" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event varchar(50) NOT NULL,
  outcome varchar(20) NOT NULL DEFAULT 'success',
  actor_user_id uuid NULL,
  request_id varchar(100) NULL,
  trace_id varchar(100) NULL,
  path varchar(255) NULL,
  method varchar(10) NULL,
  http_status smallint NULL,
  metadata jsonb NULL,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logs_access_logs_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE INDEX IF NOT EXISTS logs_logging_occurred_at_idx
  ON "logs"."logging" (occurred_at);
CREATE INDEX IF NOT EXISTS logs_audit_trails_audited_at_idx
  ON "logs"."audit_trails" (audited_at);
CREATE INDEX IF NOT EXISTS logs_access_logs_accessed_at_idx
  ON "logs"."access_logs" (accessed_at);
