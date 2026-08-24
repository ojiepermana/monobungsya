ALTER TABLE "jobs"."job_retry_request"
  DROP CONSTRAINT IF EXISTS "job_retry_request_source_job_id_fkey",
  DROP CONSTRAINT IF EXISTS "job_retry_request_new_job_id_fkey";

ALTER TABLE "jobs"."job_retry_request"
  ADD CONSTRAINT "job_retry_request_source_job_id_fkey"
    FOREIGN KEY (source_job_id) REFERENCES "jobs"."job"(id),
  ADD CONSTRAINT "job_retry_request_new_job_id_fkey"
    FOREIGN KEY (new_job_id) REFERENCES "jobs"."job"(id);
