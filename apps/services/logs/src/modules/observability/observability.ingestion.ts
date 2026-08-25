import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '#project/errors';
import { canonicalJson, sha256 } from '#project/telemetry';

export interface IngestionVerificationOptions {
  keys: ReadonlyMap<string, string>;
  maxBytes: number;
  clockSkewSeconds: number;
}

export interface VerifiedIngestion {
  keyId: string;
  nonce: string;
  bodyChecksum: string;
}

export function parseIngestionKeys(value: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const keyId = entry.slice(0, separator).trim();
    const secret = entry.slice(separator + 1).trim();
    if (keyId && secret) keys.set(keyId, secret);
  }
  return keys;
}

function signatureInput(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyChecksum: string,
): string {
  return [method, path, timestamp, nonce, bodyChecksum].join('\n');
}

function equalSignature(actual: string, expected: string): boolean {
  const normalized = actual.startsWith('sha256=')
    ? actual.slice('sha256='.length)
    : actual;
  const left = Buffer.from(normalized, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyIngestionRequest(
  request: Request,
  body: unknown,
  options: IngestionVerificationOptions,
): VerifiedIngestion {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > options.maxBytes) {
    throw new ValidationError(
      'Benchmark ingestion body exceeds the size limit',
    );
  }
  if (options.keys.size === 0) {
    throw new UnauthorizedError('Benchmark ingestion is not configured');
  }

  const keyId = request.headers.get('x-observability-key-id')?.trim();
  const timestamp = request.headers.get('x-observability-timestamp')?.trim();
  const nonce = request.headers.get('x-observability-nonce')?.trim();
  const signature = request.headers.get('x-observability-signature')?.trim();
  if (!keyId || !timestamp || !nonce || !signature) {
    throw new UnauthorizedError('Benchmark ingestion signature is incomplete');
  }
  const numericTimestamp = Number(timestamp);
  const timestampMs = Number.isFinite(numericTimestamp)
    ? numericTimestamp < 10_000_000_000
      ? numericTimestamp * 1000
      : numericTimestamp
    : Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > options.clockSkewSeconds * 1000
  ) {
    throw new UnauthorizedError(
      'Benchmark ingestion timestamp is outside the allowed skew',
    );
  }

  const secret = options.keys.get(keyId);
  if (!secret)
    throw new UnauthorizedError('Benchmark ingestion key is unknown');
  const bodyChecksum = sha256(canonicalJson(body));
  const expected = createHmac('sha256', secret)
    .update(
      signatureInput(
        request.method,
        new URL(request.url).pathname,
        timestamp,
        nonce,
        bodyChecksum,
      ),
    )
    .digest('hex');
  if (!equalSignature(signature, expected)) {
    throw new UnauthorizedError('Benchmark ingestion signature is invalid');
  }
  if (nonce.length > 150) {
    throw new ValidationError('Benchmark ingestion nonce is too long');
  }
  return { keyId, nonce, bodyChecksum };
}

export function assertReplayConflict(
  message = 'Benchmark ingestion replay detected',
): never {
  throw new ConflictError(message, 'benchmark_ingestion_replay');
}
