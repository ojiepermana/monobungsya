import type { DatabaseClient } from '#project/database';
import { jobFailureNotificationContract } from './contracts';

export const JOB_PAYLOAD_LIMIT_BYTES = 64 * 1024;
export const DEFAULT_WORKER_CONCURRENCY = 5;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_MS = 60_000;
export const DEFAULT_HEARTBEAT_MS = 20_000;
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

const FORBIDDEN_PAYLOAD_KEYS =
  /(token|secret|password|credential|privatekey|apikey)/i;

export type JobStatus =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'completed'
  | 'failed';

export interface JobRecord {
  id: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  source_service: string;
  target_service: string;
  idempotency_key: string;
  correlation_id: string | null;
  actor_user_id: string | null;
  status: JobStatus;
  priority: number;
  run_at: string;
  attempt_count: number;
  max_attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  lease_expires_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  schedule_code: string | null;
  retry_of_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobHandlerContext {
  job: JobRecord;
  signal: AbortSignal;
}

export type JobHandler<TPayload> = (
  payload: TPayload,
  context: JobHandlerContext,
) => Promise<void>;

export interface JobScheduleDefinition {
  code: string;
  cronExpression: string;
  timezone: string;
  enabled?: boolean;
}

export interface JobContract<TPayload = unknown> {
  type: string;
  version: number;
  sourceService: string;
  targetService: string;
  validate: (payload: unknown) => payload is TPayload;
  domainIdempotencyKey: (payload: TPayload, job: JobRecord) => string;
  operatorPayloadKeys: readonly string[];
  maxAttempts?: number;
  concurrencyLimit?: number;
  isRetryable?: (error: unknown) => boolean;
  terminalFailureNotification?: boolean;
  schedules?: readonly JobScheduleDefinition[];
}

export interface JobDefinition<TPayload = unknown>
  extends JobContract<TPayload> {
  handler: JobHandler<TPayload>;
}

export interface EnqueueJobInput {
  type: string;
  version: number;
  payload: unknown;
  sourceService: string;
  targetService: string;
  idempotencyKey: string;
  correlationId?: string | null;
  actorUserId?: string | null;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  scheduleCode?: string | null;
  retryOfJobId?: string | null;
}

export interface JobFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobRuntime {
  enqueue?(input: EnqueueJobInput): Promise<JobRecord>;
  claim(
    workerId: string,
    targetService: string,
    limit?: number,
    leaseMs?: number,
  ): Promise<JobRecord[]>;
  heartbeat(
    jobId: string,
    workerId: string,
    leaseMs?: number,
  ): Promise<boolean>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(
    job: Pick<JobRecord, 'id' | 'type' | 'version' | 'attempt_count'>,
    workerId: string,
    failure: JobFailure,
    now?: Date,
  ): Promise<boolean>;
  release(jobId: string, workerId: string): Promise<boolean>;
}

export type JobWorkerEventName =
  | 'job.claimed'
  | 'job.completed'
  | 'job.failed'
  | 'job.released'
  | 'job.heartbeat_lost'
  | 'job.worker_error';

export interface JobWorkerEvent {
  name: JobWorkerEventName;
  job?: JobRecord;
  failure?: JobFailure;
  error?: unknown;
}

export interface JobWorkerOptions {
  workerId: string;
  targetService: string;
  concurrency?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  pollIntervalMs?: number;
  shutdownTimeoutMs?: number;
  onEvent?: (event: JobWorkerEvent) => void;
}

export class JobRegistry {
  private readonly contracts = new Map<string, JobContract<never>>();
  private readonly handlers = new Map<string, JobHandler<never>>();

  register<TPayload>(definition: JobDefinition<TPayload>): void {
    this.registerContract(definition);
    this.bind(definition, definition.handler);
  }

  registerContract<TPayload>(contract: JobContract<TPayload>): void {
    validateContract(contract as unknown as JobContract<never>);
    const key = definitionKey(contract.type, contract.version);

    if (this.contracts.has(key)) {
      throw new Error(`job definition already registered: ${key}`);
    }

    for (const schedule of contract.schedules ?? []) {
      const existing = this.findSchedule(schedule.code);
      if (existing) {
        throw new Error(`job schedule already registered: ${schedule.code}`);
      }
    }

    this.contracts.set(key, contract as unknown as JobContract<never>);
  }

  bind<TPayload>(
    contract: JobContract<TPayload>,
    handler: JobHandler<TPayload>,
  ): void {
    validateContract(contract as unknown as JobContract<never>);
    if (typeof handler !== 'function') {
      throw new Error('job handler is required');
    }

    const key = definitionKey(contract.type, contract.version);
    const existing = this.contracts.get(key);
    if (!existing) {
      this.registerContract(contract);
    } else if (!sameContract(existing, contract)) {
      throw new Error(`job contract metadata mismatch: ${key}`);
    }

    if (this.handlers.has(key)) {
      throw new Error(`job handler already bound: ${key}`);
    }

    this.handlers.set(key, handler as unknown as JobHandler<never>);
  }

  get(type: string, version: number): JobContract<never> | undefined {
    return this.contracts.get(definitionKey(type, version));
  }

  getBoundDefinition(
    type: string,
    version: number,
  ): JobDefinition<never> | undefined {
    const contract = this.get(type, version);
    const handler = this.handlers.get(definitionKey(type, version));
    if (!contract || !handler) return undefined;
    return { ...contract, handler };
  }

  getContracts(): readonly JobContract<never>[] {
    return [...this.contracts.values()];
  }

  getScheduledContracts(): readonly {
    contract: JobContract<never>;
    schedule: JobScheduleDefinition;
  }[] {
    return [...this.contracts.values()].flatMap((contract) =>
      (contract.schedules ?? []).map((schedule) => ({ contract, schedule })),
    );
  }

  assertReadyForTarget(targetService: string): void {
    const missing = [...this.contracts.values()]
      .filter((contract) => contract.targetService === targetService)
      .filter(
        (contract) =>
          !this.handlers.has(definitionKey(contract.type, contract.version)),
      )
      .map((contract) => `${contract.type}@${contract.version}`);

    if (missing.length > 0) {
      throw new Error(
        `missing job handlers for ${targetService}: ${missing.join(', ')}`,
      );
    }
  }

  assertPayload(
    type: string,
    version: number,
    payload: unknown,
  ): JobContract<never> {
    const contract = this.get(type, version);
    if (!contract) {
      throw new Error(`unknown job type or version: ${type}@${version}`);
    }

    assertSafePayload(payload);
    if (!contract.validate(payload)) {
      throw new Error(`invalid payload for job ${type}@${version}`);
    }

    return contract;
  }

  operatorPayload(
    type: string,
    version: number,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const contract = this.get(type, version);
    if (!contract) {
      throw new Error(`unknown job type or version: ${type}@${version}`);
    }

    return Object.fromEntries(
      contract.operatorPayloadKeys
        .filter((key) => Object.hasOwn(payload, key))
        .map((key) => [key, payload[key]]),
    );
  }

  private findSchedule(code: string): JobScheduleDefinition | undefined {
    return [...this.contracts.values()]
      .flatMap((contract) => contract.schedules ?? [])
      .find((schedule) => schedule.code === code);
  }
}

export class DurableJobRuntime {
  constructor(
    private readonly database: DatabaseClient,
    private readonly registry: JobRegistry,
  ) {}

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    return enqueueJob(this.database, this.registry, input);
  }

  async claim(
    workerId: string,
    targetService: string,
    limit = 1,
    leaseMs = DEFAULT_LEASE_MS,
  ): Promise<JobRecord[]> {
    if (!workerId || !targetService)
      throw new Error('worker identity is required');
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('claim limit must be positive');
    if (!Number.isInteger(leaseMs) || leaseMs < 1)
      throw new Error('lease must be positive');

    const rows = await this.database`
      SELECT * FROM jobs.claim_jobs(${workerId}, ${targetService}, ${limit}, ${leaseMs})
    `;
    return rows as JobRecord[];
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseMs = DEFAULT_LEASE_MS,
  ): Promise<boolean> {
    const rows = await this.database`
      SELECT jobs.heartbeat_job(${jobId}, ${workerId}, ${leaseMs}) AS ok
    `;
    return Boolean((rows[0] as { ok?: boolean } | undefined)?.ok);
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const rows = await this.database`
      SELECT jobs.complete_job(${jobId}, ${workerId}) AS ok
    `;
    return Boolean((rows[0] as { ok?: boolean } | undefined)?.ok);
  }

  async release(jobId: string, workerId: string): Promise<boolean> {
    const rows = await this.database`
      SELECT jobs.release_job(${jobId}, ${workerId}) AS ok
    `;
    return Boolean((rows[0] as { ok?: boolean } | undefined)?.ok);
  }

  async fail(
    job: Pick<JobRecord, 'id' | 'type' | 'version' | 'attempt_count'>,
    workerId: string,
    failure: JobFailure,
    now = new Date(),
  ): Promise<boolean> {
    const definition = this.registry.get(job.type, job.version);
    const retryable = definition?.isRetryable
      ? definition.isRetryable(failure)
      : failure.retryable;
    const retryAt = retryable
      ? new Date(now.getTime() + retryDelayMs(job.attempt_count, Math.random()))
      : null;
    const rows = await this.database`
      SELECT jobs.fail_job(
        ${job.id},
        ${workerId},
        ${failure.code.slice(0, 100)},
        ${failure.message.slice(0, 1000)},
        ${retryable},
        ${retryAt}
      ) AS ok
    `;
    return Boolean((rows[0] as { ok?: boolean } | undefined)?.ok);
  }

  async recoverExpired(now = new Date()): Promise<number> {
    const rows = await this.database`
      SELECT jobs.reap_expired_jobs(${now}) AS recovered
    `;
    return Number(
      (rows[0] as { recovered?: number } | undefined)?.recovered ?? 0,
    );
  }
}

export class DurableJobWorker {
  private readonly workerId: string;
  private readonly targetService: string;
  private readonly concurrency: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollIntervalMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly onEvent?: (event: JobWorkerEvent) => void;
  private readonly active = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeByType = new Map<string, number>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private stopping = false;
  private forcedShutdown = false;
  private stopPromise: Promise<void> | undefined;

  constructor(
    private readonly runtime: JobRuntime,
    private readonly registry: JobRegistry,
    options: JobWorkerOptions,
  ) {
    if (!options.workerId || !options.targetService) {
      throw new Error('worker identity is required');
    }

    this.workerId = options.workerId;
    this.targetService = options.targetService;
    this.concurrency = positiveInteger(
      options.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
      'worker concurrency',
    );
    this.leaseMs = positiveInteger(
      options.leaseMs ?? DEFAULT_LEASE_MS,
      'worker lease',
    );
    this.heartbeatMs = positiveInteger(
      options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      'worker heartbeat',
    );
    this.pollIntervalMs = positiveInteger(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'worker poll interval',
    );
    this.shutdownTimeoutMs = positiveInteger(
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      'worker shutdown timeout',
    );
    this.onEvent = options.onEvent;
    this.registry.assertReadyForTarget(this.targetService);
  }

  start(): void {
    if (this.started || this.stopping) return;
    this.started = true;
    this.schedulePoll(0);
  }

  async runOnce(): Promise<number> {
    if (this.stopping) return 0;

    const available = this.concurrency - this.active.size;
    if (available < 1) return 0;

    const jobs = await this.runtime.claim(
      this.workerId,
      this.targetService,
      available,
      this.leaseMs,
    );

    for (const job of jobs.slice(0, available)) {
      const contract = this.registry.get(job.type, job.version);
      const current = this.activeByType.get(job.type) ?? 0;
      const limit = contract?.concurrencyLimit ?? this.concurrency;

      if (current >= limit) {
        void this.runtime
          .release(job.id, this.workerId)
          .then((released) => {
            if (released) this.emit({ name: 'job.released', job });
          })
          .catch((error) =>
            this.emit({ name: 'job.worker_error', job, error }),
          );
        continue;
      }

      this.activeByType.set(job.type, current + 1);
      this.emit({ name: 'job.claimed', job });
      const task = this.process(job);
      this.active.set(job.id, task);
      void task.finally(() => {
        this.active.delete(job.id);
        const count = this.activeByType.get(job.type) ?? 1;
        if (count <= 1) this.activeByType.delete(job.type);
        else this.activeByType.set(job.type, count - 1);
      });
    }

    return jobs.length;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;

    this.stopPromise = this.shutdown();
    return this.stopPromise;
  }

  private async process(job: JobRecord): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    let leaseLost = false;
    const heartbeatTimer = setInterval(() => {
      void this.runtime
        .heartbeat(job.id, this.workerId, this.leaseMs)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            controller.abort('job lease lost');
            this.emit({ name: 'job.heartbeat_lost', job });
          }
        })
        .catch((error) => {
          leaseLost = true;
          controller.abort('job heartbeat failed');
          this.emit({ name: 'job.worker_error', job, error });
        });
    }, this.heartbeatMs);
    heartbeatTimer.unref();

    let contract: JobContract<never> | undefined;
    try {
      contract = this.registry.get(job.type, job.version);
      if (!contract) {
        const failure = {
          code: 'unknown_job_definition',
          message: `unknown job type or version: ${job.type}@${job.version}`,
          retryable: false,
        } satisfies JobFailure;
        if (!this.forcedShutdown) {
          await this.runtime.fail(job, this.workerId, failure);
          this.emit({ name: 'job.failed', job, failure });
        }
        return;
      }

      const definition = this.registry.getBoundDefinition(
        job.type,
        job.version,
      );
      if (!definition) {
        const failure = {
          code: 'missing_job_handler',
          message: 'job handler is not registered in the target service',
          retryable: false,
        } satisfies JobFailure;
        if (!this.forcedShutdown) {
          try {
            await this.runtime.fail(job, this.workerId, failure);
            this.emit({ name: 'job.failed', job, failure });
            await this.notifyTerminalFailure(job, contract, failure);
          } catch (persistenceError) {
            this.emit({
              name: 'job.worker_error',
              job,
              error: persistenceError,
            });
          }
        }
        return;
      }

      this.registry.assertPayload(job.type, job.version, job.payload);
      const typedDefinition = definition as unknown as JobDefinition<
        Record<string, unknown>
      >;
      await typedDefinition.handler(job.payload, {
        job,
        signal: controller.signal,
      });

      if (!leaseLost && !this.forcedShutdown && !controller.signal.aborted) {
        try {
          const completed = await this.runtime.complete(job.id, this.workerId);
          if (completed) this.emit({ name: 'job.completed', job });
        } catch (error) {
          this.emit({ name: 'job.worker_error', job, error });
        }
      }
    } catch (error) {
      if (leaseLost || this.forcedShutdown || controller.signal.aborted) return;

      const failure = toJobFailure(error);
      try {
        await this.runtime.fail(job, this.workerId, failure);
        this.emit({ name: 'job.failed', job, failure });
        await this.notifyTerminalFailure(job, contract, failure);
      } catch (persistenceError) {
        this.emit({ name: 'job.worker_error', job, error: persistenceError });
      }
    } finally {
      clearInterval(heartbeatTimer);
      this.controllers.delete(job.id);
    }
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopping) return;

    this.pollTimer = setTimeout(async () => {
      this.pollTimer = undefined;
      try {
        await this.runOnce();
      } catch (error) {
        this.emit({ name: 'job.worker_error', error });
      }
      this.schedulePoll(this.pollIntervalMs);
    }, delayMs);
    this.pollTimer.unref();
  }

  private async notifyTerminalFailure(
    job: JobRecord,
    contract: JobContract<never> | undefined,
    failure: JobFailure,
  ): Promise<void> {
    const terminal =
      !failure.retryable || job.attempt_count >= job.max_attempts;
    if (!terminal || contract?.terminalFailureNotification !== true) return;
    if (!this.runtime.enqueue) return;

    const payload = {
      jobId: job.id,
      jobType: job.type,
      attemptCount: job.attempt_count,
      failedAt: new Date().toISOString(),
    };
    await this.runtime.enqueue({
      type: jobFailureNotificationContract.type,
      version: jobFailureNotificationContract.version,
      payload,
      sourceService: jobFailureNotificationContract.sourceService,
      targetService: jobFailureNotificationContract.targetService,
      idempotencyKey: jobFailureNotificationContract.domainIdempotencyKey(
        payload,
        job,
      ),
      correlationId: job.correlation_id,
      actorUserId: null,
    });
  }

  private async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);

    const activeTasks = [...this.active.values()];
    if (activeTasks.length === 0) return;

    const drained = await Promise.race([
      Promise.allSettled(activeTasks).then(() => true),
      timeout(this.shutdownTimeoutMs).then(() => false),
    ]);

    if (drained) return;

    this.forcedShutdown = true;
    for (const controller of this.controllers.values()) {
      controller.abort('worker shutdown timeout');
    }

    await Promise.all(
      [...this.controllers.keys()].map(async (jobId) => {
        try {
          const released = await this.runtime.release(jobId, this.workerId);
          if (released) this.emit({ name: 'job.released' });
        } catch (error) {
          this.emit({ name: 'job.worker_error', error });
        }
      }),
    );
  }

  private emit(event: JobWorkerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Observability must not change job state or stop a worker.
    }
  }
}

export function toJobFailure(error: unknown): JobFailure {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code =
    typeof candidate?.code === 'string' ? candidate.code : 'handler_error';
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof candidate?.message === 'string'
        ? candidate.message
        : String(error);
  const message = FORBIDDEN_PAYLOAD_KEYS.test(rawMessage.replaceAll('_', ''))
    ? 'job handler failed'
    : rawMessage;

  return {
    code: code.slice(0, 100),
    message: message.slice(0, 1000),
    retryable: true,
  };
}

export async function enqueueJob(
  database: DatabaseClient,
  registry: JobRegistry,
  input: EnqueueJobInput,
): Promise<JobRecord> {
  const definition = registry.assertPayload(
    input.type,
    input.version,
    input.payload,
  );

  if (definition.sourceService !== input.sourceService) {
    throw new Error(
      `source service does not own ${input.type}@${input.version}`,
    );
  }
  if (definition.targetService !== input.targetService) {
    throw new Error(
      `target service does not own ${input.type}@${input.version}`,
    );
  }

  const rows = await database`
    SELECT * FROM jobs.enqueue_job(
      ${input.type},
      ${input.version},
      ${input.payload}::jsonb,
      ${input.sourceService},
      ${input.targetService},
      ${input.idempotencyKey},
      ${input.correlationId ?? null},
      ${input.actorUserId ?? null},
      ${input.priority ?? 0},
      ${input.runAt ?? new Date()},
      ${input.maxAttempts ?? definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS},
      ${input.scheduleCode ?? null},
      ${input.retryOfJobId ?? null}
    )
  `;

  const row = rows[0] as JobRecord | undefined;
  if (!row) throw new Error('job enqueue returned no row');
  return row;
}

export function retryDelayMs(
  attemptNumber: number,
  random = Math.random(),
): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error('attempt number must be positive');
  }
  if (random < 0 || random > 1)
    throw new Error('random must be between 0 and 1');

  const base = Math.min(5_000 * 2 ** (attemptNumber - 1), 15 * 60_000);
  return Math.round(base * (1 + random * 0.2));
}

export function assertSafePayload(
  payload: unknown,
): asserts payload is Record<string, unknown> {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined)
    throw new Error('job payload must be JSON serializable');
  if (
    new TextEncoder().encode(serialized).byteLength > JOB_PAYLOAD_LIMIT_BYTES
  ) {
    throw new Error(`job payload exceeds ${JOB_PAYLOAD_LIMIT_BYTES} bytes`);
  }

  walkPayload(payload, '$');
}

function walkPayload(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`job payload contains a non-finite number at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkPayload(entry, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== 'object')
    throw new Error(`job payload contains an unsupported value at ${path}`);

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.test(key.replaceAll('_', ''))) {
      throw new Error(
        `job payload contains a sensitive field at ${path}.${key}`,
      );
    }
    walkPayload(entry, `${path}.${key}`);
  }
}

function validateContract(contract: JobContract<never>): void {
  if (!/^[a-z][a-z0-9_.-]{1,99}$/.test(contract.type)) {
    throw new Error(`invalid job type: ${contract.type}`);
  }
  if (!Number.isInteger(contract.version) || contract.version < 1) {
    throw new Error('job version must be a positive integer');
  }
  if (
    !/^[a-z][a-z0-9_-]{0,63}$/.test(contract.sourceService) ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(contract.targetService)
  ) {
    throw new Error('job source and target services are required');
  }
  const maxAttempts = contract.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('job max attempts must be between 1 and 100');
  }
  if (
    contract.concurrencyLimit !== undefined &&
    (!Number.isInteger(contract.concurrencyLimit) ||
      contract.concurrencyLimit < 1 ||
      contract.concurrencyLimit > DEFAULT_WORKER_CONCURRENCY)
  ) {
    throw new Error(
      `job concurrency limit must be between 1 and ${DEFAULT_WORKER_CONCURRENCY}`,
    );
  }
  if (typeof contract.validate !== 'function') {
    throw new Error('job payload validator is required');
  }
  if (typeof contract.domainIdempotencyKey !== 'function') {
    throw new Error('job domain idempotency strategy is required');
  }
  if (
    !Array.isArray(contract.operatorPayloadKeys) ||
    contract.operatorPayloadKeys.some((key) => typeof key !== 'string')
  ) {
    throw new Error('job operator payload keys must be strings');
  }
  if (
    contract.terminalFailureNotification !== undefined &&
    typeof contract.terminalFailureNotification !== 'boolean'
  ) {
    throw new Error('job terminal failure notification must be boolean');
  }

  const schedules = contract.schedules ?? [];
  if (schedules.length > 0 && contract.sourceService !== 'jobs') {
    throw new Error('scheduled job contracts must use source service jobs');
  }
  const scheduleCodes = new Set<string>();
  for (const schedule of schedules) {
    if (
      !/^[a-z][a-z0-9_.-]{1,119}$/.test(schedule.code) ||
      scheduleCodes.has(schedule.code)
    ) {
      throw new Error(`invalid job schedule code: ${schedule.code}`);
    }
    if (
      !schedule.cronExpression.trim() ||
      schedule.cronExpression.length > 255
    ) {
      throw new Error(`invalid cron expression for schedule: ${schedule.code}`);
    }
    if (!schedule.timezone.trim() || schedule.timezone.length > 100) {
      throw new Error(`invalid timezone for schedule: ${schedule.code}`);
    }
    if (
      schedule.enabled !== undefined &&
      typeof schedule.enabled !== 'boolean'
    ) {
      throw new Error(`invalid enabled flag for schedule: ${schedule.code}`);
    }
    scheduleCodes.add(schedule.code);
  }
}

function sameContract<TPayload>(
  left: JobContract<never>,
  right: JobContract<TPayload>,
): boolean {
  return (
    JSON.stringify(contractMetadata(left)) ===
    JSON.stringify(contractMetadata(right))
  );
}

function contractMetadata<TPayload>(contract: JobContract<TPayload>) {
  return {
    type: contract.type,
    version: contract.version,
    sourceService: contract.sourceService,
    targetService: contract.targetService,
    operatorPayloadKeys: [...contract.operatorPayloadKeys],
    maxAttempts: contract.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    concurrencyLimit: contract.concurrencyLimit ?? null,
    terminalFailureNotification: contract.terminalFailureNotification ?? false,
    schedules: (contract.schedules ?? []).map((schedule) => ({
      code: schedule.code,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: schedule.enabled ?? true,
    })),
  };
}

function definitionKey(type: string, version: number): string {
  return `${type}@${version}`;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function timeout(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export type {
  AuthCleanupExpiredSecurityDataPayload,
  AuthSendUserInvitationPayload,
  JobFailureNotificationPayload,
  NotificationCreatePayload,
  NotificationEmailDeliveryPayload,
  NotificationRecipientCapabilitySyncPayload,
  NotificationRecipientSyncPayload,
} from './contracts';
export {
  AUTH_JOB_CONTRACTS,
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  authCleanupExpiredSecurityDataContract,
  authNotificationCreateContract,
  authSendUserInvitationContract,
  jobFailureNotificationContract,
  NOTIFICATION_JOB_CONTRACTS,
  notificationCreateContract,
  notificationEmailDeliveryContract,
  notificationRecipientSyncContract,
} from './contracts';
export {
  DurableJobScheduler,
  dueOccurrences,
  type JobScheduleRow,
  nextOccurrence,
  type SchedulerEvent,
  type SchedulerOptions,
} from './scheduler';
