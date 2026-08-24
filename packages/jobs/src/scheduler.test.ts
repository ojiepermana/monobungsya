import { describe, expect, test } from 'bun:test';
import { dueOccurrences, nextOccurrence } from './scheduler';

describe('durable job scheduler cron calculations', () => {
  test('calculates the next occurrence in the declared IANA timezone', () => {
    const next = nextOccurrence(
      '0 3 * * *',
      'Asia/Jakarta',
      new Date('2026-08-24T00:00:00.000Z'),
    );

    expect(next.toISOString()).toBe('2026-08-24T20:00:00.000Z');
  });

  test('returns missed occurrences in chronological order', () => {
    const occurrences = dueOccurrences(
      '0 3 * * *',
      'Asia/Jakarta',
      new Date('2026-08-22T20:00:00.000Z'),
      new Date('2026-08-24T00:00:00.000Z'),
    );

    expect(occurrences.map((date) => date.toISOString())).toEqual([
      '2026-08-22T20:00:00.000Z',
      '2026-08-23T20:00:00.000Z',
    ]);
  });

  test('rejects an invalid timezone during schedule validation', () => {
    expect(() =>
      nextOccurrence(
        '0 3 * * *',
        'Not/A_Timezone',
        new Date('2026-08-24T00:00:00.000Z'),
      ),
    ).toThrow();
  });
});
