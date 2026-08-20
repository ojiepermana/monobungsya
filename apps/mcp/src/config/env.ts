export interface McpEnvironment {
  ERP_URL: string;
  ERP_TOKEN: string;
}

function required(
  source: Record<string, string | undefined>,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadMcpEnv(
  source: Record<string, string | undefined> = process.env,
): McpEnvironment {
  return {
    ERP_URL: required(source, "ERP_URL"),
    ERP_TOKEN: required(source, "ERP_TOKEN"),
  };
}

export const env = loadMcpEnv();
