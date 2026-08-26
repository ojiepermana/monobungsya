import { Buffer } from 'node:buffer';
import { ValidationError } from '#project/errors';
import { canonicalJson, sha256 } from '#project/telemetry';
import type { TraceQuery } from './observability.types';

export const TRACE_CURSOR_VERSION = 1;
export const TRACE_CURSOR_MAX_LENGTH = 512;
export const TRACE_CURSOR_SORT_KEY =
  'trace_started_at_desc_trace_id_desc' as const;

const TRACE_CURSOR_ERROR =
  'The trace cursor is invalid or does not match the filters';
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TRACE_PAGE_SIZE = 50;

export type TraceCursorDirection = 'next' | 'prev';

export interface TraceCursor {
  version: typeof TRACE_CURSOR_VERSION;
  signalKind: 'trace';
  direction: TraceCursorDirection;
  startedAt: string;
  traceId: string;
  sortKey: typeof TRACE_CURSOR_SORT_KEY;
  filterFingerprint: string;
}

export type TraceCursorScope = Omit<TraceQuery, 'from' | 'to'> & {
  from: Date;
  to: Date;
};

function base64UrlEncode(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > TRACE_CURSOR_MAX_LENGTH) {
    throw new Error('Trace cursor payload exceeds the maximum length');
  }
  const encoded = btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  if (encoded.length > TRACE_CURSOR_MAX_LENGTH) {
    throw new Error('Trace cursor exceeds the maximum length');
  }
  return encoded;
}

function base64UrlDecode(value: string): string {
  if (
    value.length === 0 ||
    value.length > TRACE_CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error('invalid base64url cursor');
  }
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const decoded = atob(padded);
  if (Buffer.byteLength(decoded, 'utf8') > TRACE_CURSOR_MAX_LENGTH) {
    throw new Error('Trace cursor payload exceeds the maximum length');
  }
  return decoded;
}

function isIsoUtcInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function traceFilters(query: TraceCursorScope): Record<string, string | null> {
  return {
    service: query.service ?? null,
    resourceKind: query.resourceKind ?? null,
    resourceName: query.resourceName ?? null,
    status: query.status ?? null,
    correlationId: query.correlationId ?? null,
    requestId: query.requestId ?? null,
    runId: query.runId ?? null,
  };
}

export function traceCursorFingerprint(query: TraceCursorScope): string {
  return sha256(
    canonicalJson({
      version: TRACE_CURSOR_VERSION,
      signalKind: 'trace',
      sortKey: TRACE_CURSOR_SORT_KEY,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      filters: traceFilters(query),
      pageSize: TRACE_PAGE_SIZE,
    }),
  );
}

export function encodeTraceCursor(
  cursor: Pick<TraceCursor, 'startedAt' | 'traceId'>,
  direction: TraceCursorDirection,
  filterFingerprint: string,
): string {
  if (
    !isIsoUtcInstant(cursor.startedAt) ||
    !TRACE_ID_PATTERN.test(cursor.traceId) ||
    !SHA256_PATTERN.test(filterFingerprint)
  ) {
    throw new Error('Trace row has an invalid cursor boundary');
  }
  return base64UrlEncode(
    JSON.stringify({
      version: TRACE_CURSOR_VERSION,
      signalKind: 'trace',
      direction,
      startedAt: cursor.startedAt,
      traceId: cursor.traceId,
      sortKey: TRACE_CURSOR_SORT_KEY,
      filterFingerprint,
    } satisfies TraceCursor),
  );
}

export function traceCursorTimestamp(value: string): string {
  if (!isIsoUtcInstant(value)) {
    throw new Error('Trace cursor timestamp is invalid');
  }
  return value.replace('T', ' ').replace('Z', '');
}

export function decodeTraceCursor(
  value: string,
  expectedFilterFingerprint: string,
): TraceCursor {
  try {
    const decoded = JSON.parse(base64UrlDecode(value)) as Partial<TraceCursor>;
    if (
      decoded.version !== TRACE_CURSOR_VERSION ||
      decoded.signalKind !== 'trace' ||
      (decoded.direction !== 'next' && decoded.direction !== 'prev') ||
      typeof decoded.startedAt !== 'string' ||
      !isIsoUtcInstant(decoded.startedAt) ||
      typeof decoded.traceId !== 'string' ||
      !TRACE_ID_PATTERN.test(decoded.traceId) ||
      decoded.sortKey !== TRACE_CURSOR_SORT_KEY ||
      typeof decoded.filterFingerprint !== 'string' ||
      !SHA256_PATTERN.test(decoded.filterFingerprint) ||
      decoded.filterFingerprint !== expectedFilterFingerprint
    ) {
      throw new Error('invalid cursor');
    }
    return decoded as TraceCursor;
  } catch {
    throw new ValidationError(TRACE_CURSOR_ERROR);
  }
}
