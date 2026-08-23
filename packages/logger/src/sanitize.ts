const REDACTED = '[REDACTED]';
const CIRCULAR = '[CIRCULAR]';
const UNSUPPORTED = '[UNSUPPORTED]';
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'access-token',
  'refresh-token',
  'session-token',
  'secret',
  'code',
  'credential',
  'passkey-response',
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replaceAll('_', '-');
  return SENSITIVE_KEYS.has(normalized);
}

function sanitizeValue(value: unknown, seen: Set<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) return UNSUPPORTED;
  if (typeof value !== 'object') return UNSUPPORTED;
  if (seen.has(value)) return CIRCULAR;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, seen));
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(item, seen);
    }
    return result;
  } catch {
    return UNSUPPORTED;
  } finally {
    seen.delete(value);
  }
}

export function sanitizeLogContext(value: unknown): unknown {
  return value === undefined ? null : sanitizeValue(value, new Set<object>());
}
