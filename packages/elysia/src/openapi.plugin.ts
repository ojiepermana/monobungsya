import { type ElysiaOpenAPIConfig, openapi } from '@elysiajs/openapi';

export function createOpenApiPlugin(
  documentation: NonNullable<ElysiaOpenAPIConfig['documentation']>,
) {
  return openapi({ documentation });
}
