CREATE TABLE IF NOT EXISTS "access"."group" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT access_group_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT access_group_status_check
    CHECK (status IN ('active', 'off'))
);

CREATE UNIQUE INDEX IF NOT EXISTS access_group_name_lower_key
  ON "access"."group" (lower(name));

CREATE TABLE IF NOT EXISTS "access"."permission_group" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL
    REFERENCES "access"."group"(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL
    REFERENCES "access"."permission"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_permission_group_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT access_permission_group_unique
    UNIQUE (group_id, permission_id)
);

CREATE INDEX IF NOT EXISTS access_permission_group_group_id_idx
  ON "access"."permission_group" (group_id);

CREATE INDEX IF NOT EXISTS access_permission_group_permission_id_idx
  ON "access"."permission_group" (permission_id);

INSERT INTO "access"."permission" (
  name, code, namespace, resource, action, scope, description
) VALUES
  ('access:group:list', 'ACCESS_GROUP_LIST', 'access', 'group', 'list', NULL, 'List permission groups'),
  ('access:group:read', 'ACCESS_GROUP_READ', 'access', 'group', 'read', NULL, 'Read a permission group'),
  ('access:group:create', 'ACCESS_GROUP_CREATE', 'access', 'group', 'create', NULL, 'Create permission groups'),
  ('access:group:update', 'ACCESS_GROUP_UPDATE', 'access', 'group', 'update', NULL, 'Update permission groups'),
  ('access:group:delete', 'ACCESS_GROUP_DELETE', 'access', 'group', 'delete', NULL, 'Soft delete permission groups'),
  ('access:group:restore', 'ACCESS_GROUP_RESTORE', 'access', 'group', 'restore', NULL, 'Restore permission groups'),
  ('access:group:manage', 'ACCESS_GROUP_MANAGE', 'access', 'group', 'manage', NULL, 'Manage permission groups'),
  ('access:permission_group:list', 'ACCESS_PERMISSION_GROUP_LIST', 'access', 'permission_group', 'list', NULL, 'List group permissions'),
  ('access:permission_group:create', 'ACCESS_PERMISSION_GROUP_CREATE', 'access', 'permission_group', 'create', NULL, 'Attach permissions to groups'),
  ('access:permission_group:delete', 'ACCESS_PERMISSION_GROUP_DELETE', 'access', 'permission_group', 'delete', NULL, 'Detach permissions from groups'),
  ('access:permission_group:manage', 'ACCESS_PERMISSION_GROUP_MANAGE', 'access', 'permission_group', 'manage', NULL, 'Manage group permissions')
ON CONFLICT (name) DO UPDATE SET
  code = EXCLUDED.code,
  namespace = EXCLUDED.namespace,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  description = EXCLUDED.description,
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_access_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA "access" TO "project_access_runtime"';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "access" TO "project_access_runtime"';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "access" TO "project_access_runtime"';
  END IF;
END
$$;
