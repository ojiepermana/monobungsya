import { describe, expect, test } from 'bun:test';
import { type AlertState, evaluateAlertState } from './alerting';

const healthy = (evaluatedAt: string) => ({
  breached: false,
  hasData: true,
  evaluatedAt,
  evidenceBucket: evaluatedAt,
});

const breach = (evaluatedAt: string) => ({
  breached: true,
  hasData: true,
  evaluatedAt,
  evidenceBucket: evaluatedAt,
});

describe('alert state transitions', () => {
  test('fires after three breach windows and notifies once', () => {
    let state: AlertState | null = null;
    state = evaluateAlertState(state, breach('2026-08-25T00:00:00Z'));
    state = evaluateAlertState(state, breach('2026-08-25T00:05:00Z'));
    const fired = evaluateAlertState(state, breach('2026-08-25T00:10:00Z'));
    expect(fired.status).toBe('firing');
    expect(fired.shouldNotify).toBe(true);
    expect(fired.transitionSequence).toBe(1);
  });

  test('resolves after a firing window recovers', () => {
    const firing: AlertState = {
      status: 'firing',
      consecutiveBreachWindows: 3,
      consecutiveHealthyWindows: 0,
      transitionSequence: 1,
      firstBreachedAt: '2026-08-25T00:00:00Z',
      lastEvaluatedAt: '2026-08-25T00:10:00Z',
      evidenceBucket: '2026-08-25T00:10:00Z',
      lastNotifiedAt: null,
      resolvedAt: null,
    };
    let recovering = evaluateAlertState(
      firing,
      healthy('2026-08-25T00:15:00Z'),
    );
    recovering = evaluateAlertState(
      recovering,
      healthy('2026-08-25T00:20:00Z'),
    );
    const resolved = evaluateAlertState(
      recovering,
      healthy('2026-08-25T00:25:00Z'),
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.shouldNotify).toBe(true);
  });

  test('marks missing telemetry as unknown without recovery', () => {
    const current: AlertState = {
      status: 'firing',
      consecutiveBreachWindows: 3,
      consecutiveHealthyWindows: 0,
      transitionSequence: 1,
      firstBreachedAt: '2026-08-25T00:00:00Z',
      lastEvaluatedAt: '2026-08-25T00:10:00Z',
      evidenceBucket: null,
      lastNotifiedAt: null,
      resolvedAt: null,
    };
    const unknown = evaluateAlertState(current, {
      ...healthy('2026-08-25T00:15:00Z'),
      hasData: false,
    });
    expect(unknown.status).toBe('unknown');
    expect(unknown.shouldNotify).toBe(false);
  });

  test('uses the rule window count for recovery decisions', () => {
    const firing = evaluateAlertState(null, breach('2026-08-25T00:00:00Z'), 1);
    expect(firing.status).toBe('firing');

    const resolved = evaluateAlertState(
      firing,
      healthy('2026-08-25T00:05:00Z'),
      1,
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.shouldNotify).toBe(true);
  });
});
