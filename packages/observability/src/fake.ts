import {
  BufferedObservabilitySignalStore,
  type SignalBatch,
  type SignalTarget,
} from './store';
import type {
  AppendResult,
  ObservabilitySignal,
  ObservabilitySignalStore,
  SignalFlushResult,
  SignalStoreDiagnostics,
  StoredObservabilitySignal,
} from './types';
import { OBSERVABILITY_SIGNAL_SCHEMA_VERSION } from './types';

/** In memory adapter used by unit tests and local development without storage. */
export class FakeObservabilitySignalStore implements ObservabilitySignalStore {
  readonly signals: StoredObservabilitySignal[] = [];
  private readonly store: BufferedObservabilitySignalStore;

  constructor(
    options: Omit<
      ConstructorParameters<typeof BufferedObservabilitySignalStore>[0],
      'targets'
    > = {},
  ) {
    const target: SignalTarget = {
      name: 'fake',
      write: async (batch: SignalBatch) => {
        this.signals.push(...batch.signals);
      },
    };
    this.store = new BufferedObservabilitySignalStore({
      ...options,
      targets: [target],
    });
  }

  append(signal: ObservabilitySignal): AppendResult {
    return this.store.append(signal);
  }

  flush(timeoutMs?: number): Promise<SignalFlushResult> {
    return this.store.flush(timeoutMs);
  }

  shutdown(timeoutMs?: number): Promise<SignalFlushResult> {
    return this.store.shutdown(timeoutMs);
  }

  diagnostics(): SignalStoreDiagnostics {
    return this.store.diagnostics();
  }
}

class DisabledObservabilitySignalStore implements ObservabilitySignalStore {
  private dropped = 0;
  private reportedDropped = 0;
  private readonly blindSpotSince = new Date().toISOString();

  constructor(private readonly failureCode: string | null) {}

  append(_signal: ObservabilitySignal): AppendResult {
    this.dropped += 1;
    return { status: 'dropped', reason: 'disabled' };
  }

  async flush(): Promise<SignalFlushResult> {
    const dropped = this.dropped - this.reportedDropped;
    this.reportedDropped = this.dropped;
    return { written: 0, dropped, timedOut: false, failed: false };
  }

  shutdown(): Promise<SignalFlushResult> {
    return this.flush();
  }

  diagnostics(): SignalStoreDiagnostics {
    return {
      state: 'disabled',
      queueDepth: 0,
      queueBytes: 0,
      droppedByReason: { disabled: this.dropped },
      blindSpotSince: this.blindSpotSince,
      lastAcknowledgedAt: null,
      schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      failureCode: this.failureCode,
      targets: {},
    };
  }
}

export function createDisabledObservabilitySignalStore(
  failureCode: string | null = null,
): ObservabilitySignalStore {
  return new DisabledObservabilitySignalStore(failureCode);
}
