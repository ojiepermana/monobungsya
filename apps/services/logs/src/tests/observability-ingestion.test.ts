import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { loadEnv } from '#project/config';
import type { DatabaseClient } from '#project/database';
import {
  type BenchmarkReport,
  canonicalJson,
  reportChecksum,
  sha256,
} from '#project/telemetry';
import { createApp } from '../app';
import {
  parseIngestionKeys,
  verifyIngestionRequest,
} from '../modules/observability/observability.ingestion';
import { ObservabilityRepository } from '../modules/observability/observability.repository';

const reportWithoutChecksum = {
  schemaVersion: '0014.1',
  runId: '0198f8a0-0000-7000-8000-000000000015',
  scenario: {
    scenarioId: 'runtime-telemetry-core',
    scenarioVersion: '1',
    kind: 'microbenchmark',
    overheadPolicy: 'required',
    fixtureVersion: '1',
    instrumentationSchemaVersion: '0014.1',
    thresholdPolicyVersion: '0014.default',
    manifestChecksum: 'a'.repeat(64),
  },
  runner: {
    bunVersion: '1.4.0',
    commitSha: 'candidate',
    branch: 'main',
    environment: 'staging',
    runnerProfile: {
      os: 'linux',
      arch: 'x64',
      cpuModel: 'test',
      coreCount: 4,
      memoryBytes: 1024,
      bunVersion: '1.4.0',
      networkClass: 'isolated',
      successSampleRate: 0.05,
      stagingClass: 'isolated',
      stagingTargetUrl: 'http://127.0.0.1:4314',
      stagingOwnership: 'test-owner',
      stagingCleanupStateFile: '/tmp/test-staging-state.json',
    },
  },
  source: {
    scenarioPath: 'scenario.json',
    scenarioChecksum: 'a'.repeat(64),
    sourceChecksum: 'a'.repeat(64),
  },
  startedAt: '2026-08-25T00:00:00.000Z',
  finishedAt: '2026-08-25T00:00:01.000Z',
  status: 'completed',
  telemetryComplete: true,
  droppedTelemetryCount: 0,
  latencyOverheadPercent: null,
  cpuOverheadPercent: null,
  rssOverheadPercent: null,
  metrics: {},
  driver: {
    instrumentationOn: {
      cpuMs: 0,
      cpuUtilizationPercent: 0,
      rssBytes: 0,
      heapUsedBytes: 0,
      eventLoopLagP95Ms: 0,
      throughputPerSecond: 0,
      errorCount: 0,
      operationCount: 0,
      elapsedMs: 0,
    },
    instrumentationOff: {
      cpuMs: 0,
      cpuUtilizationPercent: 0,
      rssBytes: 0,
      heapUsedBytes: 0,
      eventLoopLagP95Ms: 0,
      throughputPerSecond: 0,
      errorCount: 0,
      operationCount: 0,
      elapsedMs: 0,
    },
  },
  validity: {
    observationCount: 0,
    minimumObservations: 100,
    coefficientOfVariation: null,
    driverCpuUtilizationPercent: 0,
    driverEventLoopLagP95Ms: 0,
    throughputByConcurrency: {},
    incompleteReasons: [],
  },
  overhead: {
    policy: 'required',
    latencyP95Percent: null,
    cpuPercent: null,
    rssPercent: null,
    latencyLimitPercent: 5,
    cpuLimitPercent: 5,
    rssLimitPercent: 10,
    withinLimits: null,
  },
  comparisons: [],
  comparisonStatus: 'not_comparable',
  artifactUri: null,
  traceUri: null,
  failureReason: null,
} satisfies Omit<BenchmarkReport, 'reportChecksum'>;
const report = {
  ...reportWithoutChecksum,
  reportChecksum: reportChecksum(reportWithoutChecksum),
};

function signedRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  keyId = 'active',
) {
  const bodyChecksum = sha256(canonicalJson(report));
  const input = [
    'POST',
    '/internal/observability/benchmark-ingestions',
    timestamp,
    nonce,
    bodyChecksum,
  ].join('\n');
  const signature = createHmac('sha256', secret).update(input).digest('hex');
  return new Request(
    'http://localhost/internal/observability/benchmark-ingestions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-observability-key-id': keyId,
        'x-observability-timestamp': timestamp,
        'x-observability-nonce': nonce,
        'x-observability-signature': signature,
      },
      body: JSON.stringify(report),
    },
  );
}

describe('benchmark ingestion authentication', () => {
  it('accepts the active key and canonical body checksum', () => {
    const timestamp = String(Date.now());
    const result = verifyIngestionRequest(
      signedRequest('secret', timestamp, 'nonce-1'),
      report,
      {
        keys: parseIngestionKeys('active=secret,previous=old'),
        maxBytes: 5_242_880,
        clockSkewSeconds: 60,
      },
    );
    expect(result.keyId).toBe('active');
    expect(result.bodyChecksum).toHaveLength(64);
  });

  it('accepts a rotated previous key and rejects a changed signed body', () => {
    const timestamp = String(Date.now());
    const request = signedRequest(
      'old',
      timestamp,
      'nonce-previous',
      'previous',
    );
    const result = verifyIngestionRequest(request, report, {
      keys: parseIngestionKeys('active=secret,previous=old'),
      maxBytes: 5_242_880,
      clockSkewSeconds: 60,
    });
    expect(result.keyId).toBe('previous');

    const signed = signedRequest('secret', timestamp, 'nonce-changed-body');
    const changedBody = new Request(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: JSON.stringify({ ...report, failureReason: 'changed' }),
    });
    expect(() =>
      verifyIngestionRequest(
        changedBody,
        { ...report, failureReason: 'changed' },
        {
          keys: parseIngestionKeys('active=secret'),
          maxBytes: 5_242_880,
          clockSkewSeconds: 60,
        },
      ),
    ).toThrow('signature is invalid');
  });

  it('rejects changed bodies and stale timestamps', () => {
    const timestamp = String(Date.now() - 120_000);
    expect(() =>
      verifyIngestionRequest(
        signedRequest('secret', timestamp, 'nonce-2'),
        report,
        {
          keys: parseIngestionKeys('active=secret'),
          maxBytes: 5_242_880,
          clockSkewSeconds: 60,
        },
      ),
    ).toThrow('outside the allowed skew');
  });

  it('keeps storage outages explicit after signature verification', async () => {
    const environment = loadEnv('logs', {
      NODE_ENV: 'test',
      PORT: '3103',
      OBSERVABILITY_INGESTION_KEYS: 'active=secret',
      INTERNAL_AUTH_SIGNING_SECRET: 'auth-secret',
    });
    const app = createApp(environment, {
      ingestionKeys: parseIngestionKeys('active=secret'),
    });
    const request = signedRequest('secret', String(Date.now()), 'nonce-3');
    const response = await app.handle(request);
    expect(response.status).toBe(503);
  });
});

describe('benchmark ingestion idempotency', () => {
  it('returns the cached response for a new nonce with the same body', async () => {
    const receipts: Array<Record<string, unknown>> = [];
    const transaction = {
      unsafe: async (text: string, params: unknown[] = []) => {
        if (text.includes('FOR UPDATE')) {
          return receipts.filter(
            (row) => row.key_id === params[0] && row.nonce === params[1],
          );
        }
        if (text.includes('INSERT INTO "telemetry"."benchmark_runs"')) {
          return [];
        }
        if (text.includes('INSERT INTO "telemetry"."ingestion_receipts"')) {
          receipts.push({
            key_id: params[0],
            nonce: params[1],
            body_checksum: params[3],
            response_body: params[5],
          });
        }
        return [];
      },
      array: () => ({}) as never,
    };
    const database = {
      unsafe: async (text: string, params: unknown[] = []) => {
        if (text.includes('nonce = $2')) {
          return receipts.filter(
            (row) => row.key_id === params[0] && row.nonce === params[1],
          );
        }
        if (text.includes('body_checksum = $2')) {
          return receipts.filter(
            (row) =>
              row.key_id === params[0] && row.body_checksum === params[1],
          );
        }
        return [];
      },
      begin: async <T>(operation: (value: typeof transaction) => Promise<T>) =>
        operation(transaction),
    } as unknown as DatabaseClient;
    const repository = new ObservabilityRepository(database);
    const bodyChecksum = sha256(canonicalJson(report));
    const first = await repository.ingestBenchmark(report, {
      keyId: 'active',
      nonce: 'nonce-first',
      bodyChecksum,
    });
    const second = await repository.ingestBenchmark(report, {
      keyId: 'active',
      nonce: 'nonce-second',
      bodyChecksum,
    });

    expect(second).toEqual(first);
    await expect(
      repository.ingestBenchmark(report, {
        keyId: 'active',
        nonce: 'nonce-first',
        bodyChecksum: 'b'.repeat(64),
      }),
    ).rejects.toThrow('different body');
  });
});
