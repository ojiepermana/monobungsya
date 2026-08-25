ALTER TABLE "notification"."recipient_projection"
  DROP CONSTRAINT notification_recipient_projection_id_uuidv7_check,
  DROP CONSTRAINT notification_recipient_projection_user_id_unique,
  DROP CONSTRAINT notification_recipient_projection_id_pkey,
  ADD CONSTRAINT recipient_projection_pkey PRIMARY KEY (user_id),
  DROP COLUMN id;
