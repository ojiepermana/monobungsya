DO $$
BEGIN
  RAISE EXCEPTION
    '0008_auth_magic_link_sessions is irreversible because raw token and session secrets were replaced by one way hashes';
END
$$;
