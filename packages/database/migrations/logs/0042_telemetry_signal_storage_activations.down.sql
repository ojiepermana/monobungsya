DROP TRIGGER IF EXISTS telemetry_signal_storage_activations_transition
  ON "telemetry"."signal_storage_activations";
DROP TRIGGER IF EXISTS telemetry_signal_storage_activations_immutable
  ON "telemetry"."signal_storage_activations";
DROP FUNCTION IF EXISTS "telemetry".assert_signal_storage_activation_transition();
DROP FUNCTION IF EXISTS "telemetry".assert_signal_storage_activation_immutable();
DROP TABLE IF EXISTS "telemetry"."signal_storage_activations";
