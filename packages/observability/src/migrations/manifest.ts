import manifest from '../../clickhouse-version.json';

export interface ClickHouseVersionManifest {
  manifestVersion: number;
  serverVersion: string;
  schema: {
    marker: number;
    minimum: number;
    maximum: number;
    tables: Record<string, number>;
  };
  requiredTableSettings: Record<string, number>;
  requiredWriterSettings: Record<string, number>;
  artifacts: Record<
    string,
    {
      url: string;
      sha256?: string;
      sha512?: string;
    }
  >;
}

export const CLICKHOUSE_VERSION_MANIFEST =
  manifest as ClickHouseVersionManifest;

const CLICKHOUSE_VERSION_PATTERN = /^(\d+)\.\d+\.\d+(?:\.\d+)?$/;

function majorVersion(version: string): string | null {
  return version.match(CLICKHOUSE_VERSION_PATTERN)?.[1] ?? null;
}

export function isCompatibleClickHouseVersion(
  actualVersion: string,
  expectedVersion: string = CLICKHOUSE_VERSION_MANIFEST.serverVersion,
): boolean {
  const actualMajor = majorVersion(actualVersion);
  const expectedMajor = majorVersion(expectedVersion);
  return actualMajor !== null && actualMajor === expectedMajor;
}
