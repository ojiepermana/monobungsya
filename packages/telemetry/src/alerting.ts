export type AlertStatus = 'pending' | 'firing' | 'resolved' | 'unknown';

export interface AlertState {
  status: AlertStatus;
  consecutiveBreachWindows: number;
  consecutiveHealthyWindows: number;
  transitionSequence: number;
  firstBreachedAt: string | null;
  lastEvaluatedAt: string;
  evidenceBucket: string | null;
  lastNotifiedAt: string | null;
  resolvedAt: string | null;
}

export interface AlertEvaluation {
  breached: boolean;
  hasData: boolean;
  evaluatedAt: string;
  evidenceBucket: string | null;
}

export interface AlertTransition extends AlertState {
  changed: boolean;
  shouldNotify: boolean;
}

export function evaluateAlertState(
  previous: AlertState | null,
  evaluation: AlertEvaluation,
  requiredWindows = 3,
): AlertTransition {
  const windows = Math.max(1, Math.floor(requiredWindows));
  const current: AlertState = previous ?? {
    status: 'pending',
    consecutiveBreachWindows: 0,
    consecutiveHealthyWindows: 0,
    transitionSequence: 0,
    firstBreachedAt: null,
    lastEvaluatedAt: evaluation.evaluatedAt,
    evidenceBucket: evaluation.evidenceBucket,
    lastNotifiedAt: null,
    resolvedAt: null,
  };

  if (!evaluation.hasData) {
    return {
      ...current,
      status: 'unknown',
      consecutiveHealthyWindows: 0,
      lastEvaluatedAt: evaluation.evaluatedAt,
      evidenceBucket: evaluation.evidenceBucket,
      changed: current.status !== 'unknown',
      shouldNotify: false,
    };
  }

  const nextBreachWindows = evaluation.breached
    ? current.consecutiveBreachWindows + 1
    : 0;
  const nextHealthyWindows = evaluation.breached
    ? 0
    : current.consecutiveHealthyWindows + 1;
  const wasActive =
    current.status === 'firing' ||
    current.consecutiveBreachWindows >= windows ||
    (current.firstBreachedAt !== null && current.resolvedAt === null);
  const resolved =
    !evaluation.breached && wasActive && nextHealthyWindows >= windows;
  const nextStatus: AlertStatus = evaluation.breached
    ? nextBreachWindows >= windows
      ? 'firing'
      : 'pending'
    : resolved
      ? 'resolved'
      : wasActive
        ? 'firing'
        : 'resolved';
  const changed = nextStatus !== current.status;

  return {
    ...current,
    status: resolved ? 'resolved' : nextStatus,
    consecutiveBreachWindows: nextBreachWindows,
    consecutiveHealthyWindows: nextHealthyWindows,
    transitionSequence: changed
      ? current.transitionSequence + 1
      : current.transitionSequence,
    firstBreachedAt:
      evaluation.breached && current.firstBreachedAt === null
        ? evaluation.evaluatedAt
        : current.firstBreachedAt,
    lastEvaluatedAt: evaluation.evaluatedAt,
    evidenceBucket: evaluation.evidenceBucket,
    resolvedAt: resolved ? evaluation.evaluatedAt : current.resolvedAt,
    changed,
    shouldNotify:
      changed &&
      (nextStatus === 'firing' ||
        (resolved &&
          (current.status === 'firing' || current.firstBreachedAt !== null))),
  };
}
