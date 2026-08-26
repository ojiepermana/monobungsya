import { describe, expect, test } from 'bun:test';

const queryLogConfig = Bun.file(
  new URL('../../clickhouse-config/20-query-log.xml', import.meta.url),
);

describe('ClickHouse operator query log configuration', () => {
  test('enables system.query_log with the required seven day retention', async () => {
    const source = await queryLogConfig.text();

    expect(source).toContain('<database>system</database>');
    expect(source).toContain('<table>query_log</table>');
    expect(source).toContain('<ttl>event_date + INTERVAL 7 DAY DELETE</ttl>');
    expect(source).toContain(
      '<flush_interval_milliseconds>7500</flush_interval_milliseconds>',
    );
  });
});
