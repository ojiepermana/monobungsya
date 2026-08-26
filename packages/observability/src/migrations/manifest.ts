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
