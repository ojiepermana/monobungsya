-- Drop the partitioned parents (children in schema "partition" drop with
-- them) and restore the non partitioned tables exactly as 0002 created them.

DROP TABLE IF EXISTS "logs"."audit_trails";
DROP SCHEMA IF EXISTS "partition" CASCADE;

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

CREATE INDEX IF NOT EXISTS logs_audit_trails_audited_at_idx
  ON "logs"."audit_trails" (audited_at);
