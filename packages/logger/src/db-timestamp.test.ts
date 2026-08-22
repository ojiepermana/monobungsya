import { describe, expect, it } from 'bun:test';
import { isoFromDbTimestamp } from './db-timestamp';

describe('isoFromDbTimestamp', () => {
  it('converts a millisecond timestamp to ISO 8601 UTC', () => {
    expect(isoFromDbTimestamp('2026-08-22 09:15:30.123')).toBe(
      '2026-08-22T09:15:30.123Z',
    );
  });

  it('pads missing fractional digits', () => {
    expect(isoFromDbTimestamp('2026-08-22 09:15:30')).toBe(
      '2026-08-22T09:15:30.000Z',
    );
    expect(isoFromDbTimestamp('2026-08-22 09:15:30.5')).toBe(
      '2026-08-22T09:15:30.500Z',
    );
  });

  it('truncates microsecond precision to milliseconds', () => {
    expect(isoFromDbTimestamp('2026-08-22 09:15:30.123456')).toBe(
      '2026-08-22T09:15:30.123Z',
    );
  });

  it('rejects values that are not database timestamps', () => {
    expect(() => isoFromDbTimestamp('2026-08-22T09:15:30Z')).toThrow(
      'invalid database timestamp',
    );
  });
});
