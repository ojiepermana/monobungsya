import { t } from "elysia";

export const reportsStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal("ok"),
  module: t.Literal("reports"),
});
