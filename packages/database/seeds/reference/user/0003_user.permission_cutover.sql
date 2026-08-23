DO $$
BEGIN
  UPDATE "user"."users"
  SET name = 'System User',
      email = 'admin@local.app',
      email_verified_at = now(),
      updated_at = now()
  WHERE id = '0198f8a0-0000-7000-8000-000000000001';
END
$$;
