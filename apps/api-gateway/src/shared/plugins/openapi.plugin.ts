import { openapi } from "@elysiajs/openapi";

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: "Project Public API",
      version: "0.1.0",
      description: "Public HTTP contract exposed by the API Gateway.",
    },
    tags: [
      { name: "Health", description: "Gateway health checks" },
      { name: "Auth", description: "Public auth boundary" },
      { name: "Users", description: "Public users boundary" },
    ],
  },
});
