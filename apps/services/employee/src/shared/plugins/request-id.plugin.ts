import { Elysia } from "elysia";

export const requestIdPlugin = new Elysia({
  name: "employee-request-id",
}).derive(({ request, set }) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const correlationId = request.headers.get("x-correlation-id") ?? requestId;
  set.headers["x-request-id"] = requestId;
  return { requestId, correlationId };
});
