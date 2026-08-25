import { CronExpressionParser } from 'cron-parser';
import type { DatabaseClient } from '#project/database';
import type { Telemetry } from '#project/telemetry';
import { enqueueJob, type JobRegistry } from './index';

export interface JobScheduleRow {
  code: string;
  job_type: string;
  job_version: number;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  last_run_at: string | Date | null;
  next_run_at: string | Date | null;
}

export interface SchedulerOptions {
  schedulerId: string;
  catchUpLimit?: number;
  leaseMs?: number;
  onEvent?: (event: SchedulerEvent) => void;
  telemetry?: Telemetry;
}

export interface SchedulerEvent {
  name:
    | 'schedule.synchronized'
    | 'schedule.emitted'
    | 'schedule.skipped'
    | 'schedule.error';
  code?: string;
  count?: number;
  error?: unknown;
}

const MAX_OCCURRENCE_SCAN = 10_000;

export class DurableJobScheduler {
  private readonly schedulerId: string;
  private readonly catchUpLimit: number;
  private readonly leaseMs: number;
  private readonly onEvent?: (event: SchedulerEvent) => void;
  private readonly telemetry?: Telemetry;

  constructor(
    private readonly database: DatabaseClient,
    private readonly registry: JobRegistry,
    options: SchedulerOptions,
  ) {
    if (!options.schedulerId) throw new Error('scheduler identity is required');
    this.schedulerId = options.schedulerId;
    this.catchUpLimit = positiveInteger(
      options.catchUpLimit ?? 100,
      'schedule catch up limit',
    );
    this.leaseMs = positiveInteger(options.leaseMs ?? 30_000, 'schedule lease');
    this.onEvent = options.onEvent;
    this.telemetry = options.telemetry;
  }

  async synchronize(now = new Date()): Promise<void> {
    if (this.telemetry) {
      return this.telemetry.withSpan(
        {
          resourceKind: 'scheduler.tick',
          resourceName: 'jobs.schedules.synchronize',
          operation: 'synchronize',
        },
        () => this.synchronizeInternal(now),
      );
    }
    return this.synchronizeInternal(now);
  }

  private async synchronizeInternal(now: Date): Promise<void> {
    const schedules = this.registry.getScheduledContracts();
    const codes: string[] = [];

    for (const { contract, schedule } of schedules) {
      const nextRunAt = nextOccurrence(
        schedule.cronExpression,
        schedule.timezone,
        now,
      );
      await this.database`
        SELECT jobs.sync_job_schedule(
          ${schedule.code},
          ${contract.type},
          ${contract.version},
          ${schedule.cronExpression},
          ${schedule.timezone},
          ${schedule.enabled ?? true},
          ${nextRunAt}
        )
      `;
      codes.push(schedule.code);
      this.emit({ name: 'schedule.synchronized', code: schedule.code });
    }

    await this.database`
      SELECT jobs.disable_missing_job_schedules(${codes}::jsonb)
    `;
  }

  async runOnce(now = new Date()): Promise<number> {
    if (this.telemetry) {
      return this.telemetry.withSpan(
        {
          resourceKind: 'scheduler.tick',
          resourceName: 'jobs.schedules.run_once',
          operation: 'run_once',
        },
        () => this.runOnceInternal(now),
      );
    }
    return this.runOnceInternal(now);
  }

  private async runOnceInternal(now: Date): Promise<number> {
    const rows = (await this.database`
      SELECT * FROM jobs.claim_due_schedules(
        ${this.schedulerId},
        ${now},
        ${this.catchUpLimit},
        ${this.leaseMs}
      )
    `) as JobScheduleRow[];

    for (const schedule of rows) {
      await this.materialize(schedule, now);
    }

    return rows.length;
  }

  private async materialize(
    schedule: JobScheduleRow,
    now: Date,
  ): Promise<void> {
    try {
      const contract = this.registry.get(
        schedule.job_type,
        Number(schedule.job_version),
      );
      if (!contract) {
        throw new Error(
          `unknown scheduled job contract: ${schedule.job_type}@${schedule.job_version}`,
        );
      }

      const start = toUtcDate(schedule.next_run_at);
      if (!start)
        throw new Error(`schedule has no next run time: ${schedule.code}`);
      const due = dueOccurrences(
        schedule.cron_expression,
        schedule.timezone,
        start,
        now,
      );
      const emitted = due.slice(-this.catchUpLimit);
      const skipped = Math.max(0, due.length - emitted.length);

      for (const plannedRunAt of emitted) {
        const payload = {};
        this.registry.assertPayload(contract.type, contract.version, payload);
        await enqueueJob(
          this.database,
          this.registry,
          {
            type: contract.type,
            version: contract.version,
            payload,
            sourceService: contract.sourceService,
            targetService: contract.targetService,
            idempotencyKey: `schedule:${schedule.code}:${plannedRunAt.toISOString()}`,
            correlationId:
              `schedule:${schedule.code}:${plannedRunAt.toISOString()}`.slice(
                0,
                100,
              ),
            runAt: plannedRunAt,
            maxAttempts: contract.maxAttempts,
            scheduleCode: schedule.code,
          },
          this.telemetry,
        );
      }

      const nextRunAt = nextOccurrence(
        schedule.cron_expression,
        schedule.timezone,
        now,
      );
      await this.database`
        SELECT jobs.complete_job_schedule(
          ${schedule.code},
          ${this.schedulerId},
          ${due.at(-1) ?? toUtcDate(schedule.last_run_at) ?? now},
          ${nextRunAt}
        )
      `;

      if (skipped > 0) {
        this.emit({
          name: 'schedule.skipped',
          code: schedule.code,
          count: skipped,
        });
      }
      if (emitted.length > 0) {
        this.emit({
          name: 'schedule.emitted',
          code: schedule.code,
          count: emitted.length,
        });
      }
    } catch (error) {
      this.emit({ name: 'schedule.error', code: schedule.code, error });
    }
  }

  private emit(event: SchedulerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Scheduler telemetry must not change schedule state.
    }
  }
}

export function nextOccurrence(
  expression: string,
  timezone: string,
  currentDate: Date,
): Date {
  return CronExpressionParser.parse(expression, {
    currentDate,
    tz: timezone,
  })
    .next()
    .toDate();
}

export function dueOccurrences(
  expression: string,
  timezone: string,
  firstOccurrence: Date,
  now: Date,
): Date[] {
  const interval = CronExpressionParser.parse(expression, {
    currentDate: new Date(firstOccurrence.getTime() - 1000),
    tz: timezone,
  });
  const occurrences: Date[] = [];

  for (let index = 0; index < MAX_OCCURRENCE_SCAN; index += 1) {
    const occurrence = interval.next().toDate();
    if (occurrence > now) break;
    occurrences.push(occurrence);
  }

  return occurrences;
}

function toUtcDate(value: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(
    normalized.endsWith('Z') ? normalized : `${normalized}Z`,
  );
  if (Number.isNaN(date.valueOf()))
    throw new Error(`invalid schedule timestamp: ${value}`);
  return date;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
