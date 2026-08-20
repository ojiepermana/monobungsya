import { stringify } from "yaml";
import { loadEnv } from "#project/config";
import { createApp as createGatewayApp } from "../apps/api-gateway/src/app";
import { loadGatewayEnv } from "../apps/api-gateway/src/config/env";
import { createApp as createAuthApp } from "../apps/services/auth/src/app";
import { createApp as createUserApp } from "../apps/services/user/src/app";

type SpecTarget = {
  name: string;
  output: string;
  fragment?: string;
  createApp: () => { handle(request: Request): Promise<Response> };
};

const targets: SpecTarget[] = [
  {
    name: "api-gateway",
    output: "apps/api-gateway/openapi.yaml",
    fragment: "packages/contracts/openapi/generated/public-api.openapi.yaml",
    createApp: () =>
      createGatewayApp(loadGatewayEnv({ NODE_ENV: "test", PORT: "3000" })),
  },
  {
    name: "auth",
    output: "apps/services/auth/openapi.yaml",
    fragment: "packages/contracts/openapi/fragments/auth.yaml",
    createApp: () =>
      createAuthApp(loadEnv("auth", { NODE_ENV: "test", PORT: "3101" })),
  },
  {
    name: "user",
    output: "apps/services/user/openapi.yaml",
    fragment: "packages/contracts/openapi/fragments/user.yaml",
    createApp: () =>
      createUserApp(loadEnv("user", { NODE_ENV: "test", PORT: "3102" })),
  },
];

for (const target of targets) {
  const app = target.createApp();
  const response = await app.handle(
    new Request("http://localhost/openapi/json"),
  );

  if (!response.ok) {
    throw new Error(
      `Could not generate ${target.name} OpenAPI: ${response.status}`,
    );
  }

  const document = (await response.json()) as Record<string, unknown>;
  const yaml = stringify(document);
  await Bun.write(target.output, yaml);
  if (target.fragment) await Bun.write(target.fragment, yaml);
  console.log(`Generated ${target.output}`);
}
