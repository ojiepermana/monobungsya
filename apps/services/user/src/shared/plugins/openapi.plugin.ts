import { openapi } from "@elysiajs/openapi";

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: "User Service API",
      version: "0.1.0",
      description: "Internal HTTP contract for the user service.",
    },
    tags: [
      { name: "Health", description: "Service health checks" },
      { name: "Users", description: "User module" },
    ],
  },
});
