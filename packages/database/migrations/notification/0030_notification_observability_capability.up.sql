ALTER TABLE "notification"."recipient_projection"
  ADD COLUMN IF NOT EXISTS can_read_observability boolean NOT NULL DEFAULT false;
