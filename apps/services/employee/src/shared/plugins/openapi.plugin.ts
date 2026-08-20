import { openapi } from "@elysiajs/openapi";

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: "Employee Service API",
      version: "0.1.0",
      description: "Internal HTTP contract for the employee service.",
    },
    tags: [
      { name: "Health", description: "Service health checks" },
      { name: "Employees", description: "Employee module" },
    ],
  },
});
