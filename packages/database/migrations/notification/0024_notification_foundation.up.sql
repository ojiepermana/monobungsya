CREATE SCHEMA IF NOT EXISTS "notification";

CREATE TABLE "notification"."recipient_projection" (
  user_id uuid PRIMARY KEY,
  display_name varchar(255) NOT NULL,
  email varchar(255) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  can_read_jobs boolean NOT NULL DEFAULT false,
  synced_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE TABLE "notification"."notification" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  idempotency_key varchar(255) NOT NULL UNIQUE,
  category varchar(30) NOT NULL CHECK (category IN ('security', 'access', 'account', 'operational')),
  severity varchar(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  type varchar(100) NOT NULL,
  template_key varchar(100) NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  title varchar(255) NOT NULL,
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_route varchar(255) NULL,
  read_at timestamp NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT notification_id_uuidv7_check CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);
CREATE INDEX notification_user_created_idx ON "notification"."notification" (user_id, created_at DESC, id DESC);
CREATE INDEX notification_user_unread_idx ON "notification"."notification" (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE "notification"."notification_delivery" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  notification_id uuid NOT NULL REFERENCES "notification"."notification"(id) ON DELETE CASCADE,
  channel varchar(20) NOT NULL CHECK (channel IN ('in_app', 'email')),
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'skipped', 'failed')),
  job_id uuid NULL,
  provider_message_id varchar(255) NULL,
  recipient_email varchar(255) NULL,
  queued_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  sent_at timestamp NULL,
  skipped_at timestamp NULL,
  failed_at timestamp NULL,
  error_code varchar(100) NULL,
  error_message varchar(1000) NULL,
  CONSTRAINT notification_delivery_id_uuidv7_check CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT notification_delivery_unique_channel UNIQUE (notification_id, channel)
);
CREATE INDEX notification_delivery_status_idx ON "notification"."notification_delivery" (status, queued_at);

CREATE TABLE "notification"."notification_preference" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  category varchar(30) NOT NULL CHECK (category IN ('security', 'access', 'account', 'operational')),
  channel varchar(20) NOT NULL CHECK (channel IN ('in_app', 'email')),
  enabled boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT notification_preference_id_uuidv7_check CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT notification_preference_unique_value UNIQUE (user_id, category, channel)
);
CREATE INDEX notification_preference_user_idx ON "notification"."notification_preference" (user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_notification_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA "notification" TO "project_notification_runtime"';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "notification" TO "project_notification_runtime"';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "notification" TO "project_notification_runtime"';
  END IF;
END
$$;
