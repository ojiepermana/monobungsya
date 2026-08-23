CREATE SCHEMA IF NOT EXISTS "access";

CREATE TABLE IF NOT EXISTS "access"."permission" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(100) NOT NULL UNIQUE,
  code varchar(100) NOT NULL UNIQUE,
  namespace varchar(50) NOT NULL,
  resource varchar(50) NOT NULL,
  action varchar(50) NOT NULL,
  scope varchar(50) NULL,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_permission_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT access_permission_name_format_check
    CHECK (name ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*){2,3}$')
);

CREATE TABLE IF NOT EXISTS "access"."permission_user" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  permission_id uuid NOT NULL
    REFERENCES "access"."permission"(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_permission_user_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT access_permission_user_unique_grant
    UNIQUE (permission_id, user_id)
);

CREATE INDEX IF NOT EXISTS access_permission_user_user_id_idx
  ON "access"."permission_user" (user_id);

CREATE INDEX IF NOT EXISTS access_permission_user_permission_id_idx
  ON "access"."permission_user" (permission_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_access_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA "access" TO "project_access_runtime"';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "access" TO "project_access_runtime"';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "access" TO "project_access_runtime"';
  END IF;
END
$$;
