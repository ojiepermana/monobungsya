INSERT INTO "auth"."users" (
  id,
  role,
  name,
  email,
  email_verified_at
)
VALUES (
  '0198f8a0-0000-7000-8000-000000000001',
  'legacy',
  'System User',
  'system@project.local',
  now()
)
ON CONFLICT (email) DO NOTHING;
