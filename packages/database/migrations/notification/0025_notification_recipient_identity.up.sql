ALTER TABLE "notification"."recipient_projection"
  ADD COLUMN id uuid DEFAULT uuidv7();

UPDATE "notification"."recipient_projection"
SET id = uuidv7()
WHERE id IS NULL;

ALTER TABLE "notification"."recipient_projection"
  ALTER COLUMN id SET NOT NULL,
  DROP CONSTRAINT recipient_projection_pkey,
  ADD CONSTRAINT notification_recipient_projection_id_pkey PRIMARY KEY (id),
  ADD CONSTRAINT notification_recipient_projection_user_id_unique UNIQUE (user_id),
  ADD CONSTRAINT notification_recipient_projection_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7);
