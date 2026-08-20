import { t } from "elysia";

export const usersStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal("ok"),
  module: t.Literal("users"),
});
