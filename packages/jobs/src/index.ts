import type { DatabaseClient } from '#project/database';

export const JOB_PAYLOAD_LIMIT_BYTES = 64 * 1024;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_MS = 60_000;

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

export interface JobDefinition<TPayload = unknown> {
  type: string;
  version: number;
  sourceService: string;
  targetService: string;
  validate: (payload: unknown) => payload is TPayload;
  operatorPayloadKeys: readonly string[];
  maxAttempts?: number;
  concurrencyLimit?: number;
  isRetryable?: (error: unknown) => boolean;
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

export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition>();

  register<TPayload>(definition: JobDefinition<TPayload>): void {
    validateDefinition(definition);
    const key = definitionKey(definition.type, definition.version);

    if (this.definitions.has(key)) {
      throw new Error(`job definition already registered: ${key}`);
    }

    this.definitions.set(key, definition);
  }

  get(type: string, version: number): JobDefinition | undefined {
    return this.definitions.get(definitionKey(type, version));
  }

  assertPayload(
    type: string,
    version: number,
    payload: unknown,
  ): JobDefinition {
    const definition = this.get(type, version);
    if (!definition) {
      throw new Error(`unknown job type or version: ${type}@${version}`);
    }

    assertSafePayload(payload);
    if (!definition.validate(payload)) {
      throw new Error(`invalid payload for job ${type}@${version}`);
    }

    return definition;
  }

  operatorPayload(
    type: string,
    version: number,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const definition = this.get(type, version);
    if (!definition) {
      throw new Error(`unknown job type or version: ${type}@${version}`);
    }

    return Object.fromEntries(
      definition.operatorPayloadKeys
        .filter((key) => Object.hasOwn(payload, key))
        .map((key) => [key, payload[key]]),
    );
  }
}

export class DurableJobRuntime {
  constructor(
    private readonly database: DatabaseClient,
    private readonly registry: JobRegistry,
  ) {}

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const definition = this.registry.assertPayload(
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

    const rows = await this.database`
      SELECT * FROM jobs.enqueue_job(
        ${input.type},
        ${input.version},
        ${JSON.stringify(input.payload)}::jsonb,
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

function validateDefinition(definition: JobDefinition): void {
  if (!/^[a-z][a-z0-9_.-]{1,99}$/.test(definition.type)) {
    throw new Error(`invalid job type: ${definition.type}`);
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('job version must be a positive integer');
  }
  if (!definition.sourceService || !definition.targetService) {
    throw new Error('job source and target services are required');
  }
  const maxAttempts = definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('job max attempts must be between 1 and 100');
  }
  if (
    definition.concurrencyLimit !== undefined &&
    (!Number.isInteger(definition.concurrencyLimit) ||
      definition.concurrencyLimit < 1)
  ) {
    throw new Error('job concurrency limit must be positive');
  }
}

function definitionKey(type: string, version: number): string {
  return `${type}@${version}`;
}
