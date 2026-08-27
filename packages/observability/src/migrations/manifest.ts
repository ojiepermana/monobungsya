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

export function isCompatibleClickHouseVersion(
  actualVersion: string,
  expectedVersion: string = CLICKHOUSE_VERSION_MANIFEST.serverVersion,
): boolean {
  // The schema and settings are validated against one pinned patch. A same-
  // major server can still change MergeTree or async-insert behavior, so it
  // is not a compatible deployment target until a manifest explicitly moves.
  return (
    CLICKHOUSE_VERSION_PATTERN.test(actualVersion) &&
    CLICKHOUSE_VERSION_PATTERN.test(expectedVersion) &&
    actualVersion === expectedVersion
  );
}
