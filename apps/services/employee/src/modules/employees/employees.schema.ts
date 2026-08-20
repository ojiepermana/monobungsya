import { t } from "elysia";

export const employeesStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal("ok"),
  module: t.Literal("employees"),
});
