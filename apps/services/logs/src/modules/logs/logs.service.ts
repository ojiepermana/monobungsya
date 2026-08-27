import { ValidationError } from '#project/errors';
import type { ObservabilitySignalStore } from '#project/observability';
import { ClickHouseSignalReadQuotaError } from '#project/observability';
import { LOGS_PER_PAGE, type LogsRepository } from './logs.repository';
import type {
  AccessLogsResult,
  ApplicationLogsResult,
  AuditTrailsResult,
  LogsMeta,
  SignalAccessLogsResult,
  SignalApplicationLogsResult,
} from './logs.types';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const SIGNAL_RETENTION_MS = 30 * DAY_MS;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

/** Collapse repeated whitespace and trim, so filters match stored values. */
function squish(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Parse the page query param into a positive integer, defaulting to 1. */
function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parsePageSize(value: string | undefined): number {
  const parsed = Number(value ?? LOGS_PER_PAGE);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, LOGS_PER_PAGE)
    : LOGS_PER_PAGE;
}

function buildMeta(page: number, pageSize: number, total: number): LogsMeta {
  return {
    page,
    perPage: pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

function parseUtcInstant(value: string): Date {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new ValidationError('Log time filters must be UTC ISO timestamps');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('Log time filters must be valid ISO timestamps');
  }
  return parsed;
}

function signalRange(
  fromValue: string | undefined,
  toValue: string | undefined,
  now: Date,
): { from: Date; to: Date } {
  if ((fromValue === undefined) !== (toValue === undefined)) {
    throw new ValidationError('Log time filters require both from and to');
  }
  const to = toValue ? parseUtcInstant(toValue) : now;
  const from = fromValue
    ? parseUtcInstant(fromValue)
    : new Date(to.getTime() - DAY_MS);
  const retentionStart = now.getTime() - SIGNAL_RETENTION_MS;
  if (
    from >= to ||
    from.getTime() < retentionStart ||
    to.getTime() > now.getTime() + FUTURE_CLOCK_SKEW_MS ||
    to.getTime() - from.getTime() > SIGNAL_RETENTION_MS
  ) {
    throw new ValidationError(
      'Log time range is invalid or outside the Signal retention window',
    );
  }
  return { from, to };
}

/**
 * The actorUserId filter (spec docs/specs/0007-user-management, AC-10) is
 * deliberately not echoed back in `filters`: it narrows a list to one user for
 * the user detail page rather than being one of the viewer's own filter
 * controls, so the response contract the log viewer pages read stays unchanged.
 */
export class LogsService {
  private readerBlindSpotSince: string | null = null;

  constructor(
    private readonly repository: LogsRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly signalStore?: ObservabilitySignalStore,
  ) {}

  async getAuditTrails(query: {
    search?: string;
    module?: string;
    action?: string;
    actorUserId?: string;
    page?: string;
    pageSize?: string;
  }): Promise<AuditTrailsResult> {
    const filters = {
      search: squish(query.search),
      module: squish(query.module),
      action: squish(query.action),
    };
    const page = parsePage(query.page);
    const pageSize = parsePageSize(query.pageSize);
    const { items, total } = await this.repository.listAuditTrails({
      ...filters,
      actorUserId: squish(query.actorUserId),
      page,
      pageSize,
    });

    return {
      data: items,
      meta: buildMeta(page, pageSize, total),
      filters,
      options: await this.repository.auditTrailOptions(),
    };
  }

  async getAccessLogs(query: {
    search?: string;
    event?: string;
    outcome?: string;
    traceId?: string;
    actorUserId?: string;
    page?: string;
    pageSize?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }): Promise<AccessLogsResult | SignalAccessLogsResult> {
    const filters = {
      search: squish(query.search),
      event: squish(query.event),
      outcome: squish(query.outcome),
      traceId: squish(query.traceId),
    };
    const actorUserId = squish(query.actorUserId).toLowerCase();
    const pageSize = parsePageSize(query.pageSize);
    if (this.repository.usesClickHouseSignalReads()) {
      const range = signalRange(query.from, query.to, this.now());
      return this.readSignalList(
        () =>
          this.repository.listClickHouseAccessLogs({
            ...filters,
            actorUserId,
            cursor: query.cursor,
            pageSize,
            ...range,
          }),
        (blindSpotSince): SignalAccessLogsResult => ({
          data: [],
          prevCursor: null,
          nextCursor: null,
          filters,
          options: { events: [], outcomes: [] },
          storageStatus: 'blind_spot',
          blindSpotSince,
        }),
      );
    }
    const page = parsePage(query.page);
    const { items, total } = await this.repository.listAccessLogs({
      ...filters,
      actorUserId,
      page,
      pageSize,
    });

    return {
      data: items,
      meta: buildMeta(page, pageSize, total),
      filters,
      options: await this.repository.accessLogOptions(),
    };
  }

  async getApplicationLogs(query: {
    search?: string;
    level?: string;
    module?: string;
    event?: string;
    actorUserId?: string;
    page?: string;
    pageSize?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }): Promise<ApplicationLogsResult | SignalApplicationLogsResult> {
    const filters = {
      search: squish(query.search),
      level: squish(query.level),
      module: squish(query.module),
      event: squish(query.event),
    };
    const actorUserId = squish(query.actorUserId).toLowerCase();
    const pageSize = parsePageSize(query.pageSize);
    if (this.repository.usesClickHouseSignalReads()) {
      const range = signalRange(query.from, query.to, this.now());
      return this.readSignalList(
        () =>
          this.repository.listClickHouseApplicationLogs({
            ...filters,
            actorUserId,
            cursor: query.cursor,
            pageSize,
            ...range,
          }),
        (blindSpotSince): SignalApplicationLogsResult => ({
          data: [],
          prevCursor: null,
          nextCursor: null,
          filters,
          options: { levels: [], modules: [], events: [] },
          storageStatus: 'blind_spot',
          blindSpotSince,
        }),
      );
    }
    const page = parsePage(query.page);
    const { items, total } = await this.repository.listApplicationLogs({
      ...filters,
      actorUserId,
      page,
      pageSize,
    });

    return {
      data: items,
      meta: buildMeta(page, pageSize, total),
      filters,
      options: await this.repository.applicationLogOptions(),
    };
  }

  private async readSignalList<T>(
    operation: () => Promise<T | null>,
    blindSpot: (blindSpotSince: string | null) => T,
  ): Promise<T> {
    try {
      const result = await operation();
      if (result !== null) {
        this.readerBlindSpotSince = null;
        return result;
      }
      return blindSpot(this.recordReaderBlindSpot());
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof ClickHouseSignalReadQuotaError
      ) {
        throw error;
      }
      return blindSpot(this.recordReaderBlindSpot());
    }
  }

  private recordReaderBlindSpot(): string | null {
    if (!this.readerBlindSpotSince) {
      this.readerBlindSpotSince = this.now().toISOString();
    }
    return (
      this.signalStore?.diagnostics().blindSpotSince ??
      this.readerBlindSpotSince
    );
  }
}
