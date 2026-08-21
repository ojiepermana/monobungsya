import { parse } from "yaml";

const files = [
  "apps/gateway/erp/openapi.yaml",
  "apps/services/auth/openapi.yaml",
  "apps/services/user/openapi.yaml",
];

for (const file of files) {
  const document = parse(await Bun.file(file).text()) as Record<
    string,
    unknown
  >;
  const openapi = document.openapi;
  const info = document.info as Record<string, unknown> | undefined;
  const paths = document.paths;

  if (typeof openapi !== "string" || !openapi.startsWith("3.")) {
    throw new Error(`${file} does not declare an OpenAPI 3 version`);
  }
  if (
    !info ||
    typeof info.title !== "string" ||
    typeof info.version !== "string"
  ) {
    throw new Error(`${file} is missing required info fields`);
  }
  if (!paths || typeof paths !== "object") {
    throw new Error(`${file} is missing paths`);
  }

  console.log(`Validated ${file}`);
}
