const DB_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/;

/**
 * Convert a Postgres timestamp read as ::text ('YYYY-MM-DD HH:mm:ss.SSS',
 * stored as UTC wall time) into an ISO 8601 UTC string with a 'Z' suffix.
 */
export function isoFromDbTimestamp(value: string): string {
  const match = DB_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    throw new Error(`invalid database timestamp "${value}"`);
  }

  const [, date, time, fraction] = match;
  const milliseconds = (fraction ?? '').padEnd(3, '0').slice(0, 3);

  return `${date}T${time}.${milliseconds}Z`;
}
