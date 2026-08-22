-- The system user is the first administrator: spec docs/specs/0007-user-management
-- puts every /api/v1/users route behind the admin role, so a fresh database
-- needs one admin to reach the user pages at all.
-- The conflict target is the id, the stable identity of this reference row, and
-- the role converges on re-seed so an older database catches up.
INSERT INTO "user"."users" (
  id,
  role,
  name,
  email,
  email_verified_at
)
VALUES (
  '0198f8a0-0000-7000-8000-000000000001',
  'admin',
  'System User',
  'admin@local.app',
  now()
)
ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role,
      updated_at = now();
