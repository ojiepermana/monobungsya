REVOKE EXECUTE ON FUNCTION "jobs".enqueue_job(
  varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid,
  integer, timestamp, integer, varchar, uuid, varchar
) FROM PUBLIC;

DROP FUNCTION IF EXISTS "jobs".enqueue_job(
  varchar, integer, jsonb, varchar, varchar, varchar, varchar, uuid,
  integer, timestamp, integer, varchar, uuid, varchar
);
