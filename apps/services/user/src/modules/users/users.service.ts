import {
  USER_INVITED_SUBJECT,
  type UserInvitedEvent,
} from '#project/contracts';
import { type DatabaseClient, withTransaction } from '#project/database';
import { ConflictError, NotFoundError } from '#project/errors';
import {
  authSendUserInvitationContract,
  enqueueJob,
  type JobRegistry,
} from '#project/jobs';
import { ActivityLog, type Logger } from '#project/logger';
import type { Publisher } from '#project/messaging';
import type { StatusTimestampPatch } from './repository/types/repository.types';
import { USERS_PER_PAGE, UsersRepository } from './repository/users.repository';
import {
  type CreateUserInput,
  type RequestCorrelation,
  type UpdateUserInput,
  USER_STATUSES,
  type UserActor,
  type UserRecord,
  type UserStatus,
  type UserStatusAction,
  type UsersListQuery,
  type UsersListResult,
} from './users.types';

export interface UsersServiceDependencies {
  database?: DatabaseClient;
  messaging?: Publisher;
  logger?: Logger;
  jobs?: JobRegistry;
  durableJobsEnabled?: boolean;
}

interface StatusTransition {
  /** Statuses the action may run from; anything else is a 409. */
  from: readonly UserStatus[];
  patch: StatusTimestampPatch;
}

/**
 * The whole status lifecycle in one place. `patch` only ever names the
 * timestamps the action owns, which is what makes restore put a user back into
 * the status they held before deletion: it clears deleted_at and nothing else.
 */
const TRANSITIONS: Record<UserStatusAction, StatusTransition> = {
  suspend: {
    from: ['active'],
    patch: { suspendedAt: 'now' },
  },
  unsuspend: {
    from: ['suspended'],
    patch: { suspendedAt: null },
  },
  // An escalation from suspended keeps suspended_at, so unblocking later
  // returns the user to suspended rather than straight to active.
  block: {
    from: ['active', 'suspended'],
    patch: { blockedAt: 'now' },
  },
  unblock: {
    from: ['blocked'],
    patch: { blockedAt: null },
  },
  delete: {
    from: ['active', 'suspended', 'blocked'],
    patch: { deletedAt: 'now' },
  },
  restore: {
    from: ['deleted'],
    patch: { deletedAt: null },
  },
};

function parsePage(value: string | undefined): number {
  const parsed = Number(value ?? '1');

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function summarizeChange(before: UserRecord, after: UserRecord): string {
  const parts: string[] = [];

  if (before.name !== after.name) {
    parts.push(`name: ${before.name} to ${after.name}`);
  }

  if (before.status !== after.status) {
    parts.push(`status: ${before.status} to ${after.status}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no field changed';
}

export class UsersService {
  private readonly repository: UsersRepository;
  private readonly database?: DatabaseClient;
  private readonly messaging?: Publisher;
  private readonly logger?: Logger;
  private readonly jobs?: JobRegistry;
  private readonly durableJobsEnabled: boolean;

  constructor(
    private readonly serviceName: string,
    dependencies: UsersServiceDependencies = {},
  ) {
    this.database = dependencies.database;
    this.messaging = dependencies.messaging;
    this.logger = dependencies.logger;
    this.jobs = dependencies.jobs;
    this.durableJobsEnabled = dependencies.durableJobsEnabled ?? false;
    this.repository = new UsersRepository(dependencies.database);
  }

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }

  async list(query: {
    search?: string;
    status?: UsersListQuery['status'];
    page?: string;
  }): Promise<UsersListResult> {
    const resolved: UsersListQuery = {
      search: query.search?.trim() ?? '',
      status: query.status ?? '',
      page: parsePage(query.page),
    };
    const page = await this.repository.list(resolved);

    return {
      data: page.items,
      meta: {
        page: resolved.page,
        perPage: USERS_PER_PAGE,
        total: page.total,
        totalPages: Math.ceil(page.total / USERS_PER_PAGE),
      },
      filters: { search: resolved.search, status: resolved.status },
      options: { statuses: [...USER_STATUSES] },
    };
  }

  async detail(id: string): Promise<UserRecord> {
    const user = await this.repository.findById(id);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * The id arrives from the client as a UUIDv7. Both uniqueness checks and the
   * insert share one transaction, and the audit write is the last statement
   * inside it: if the audit or durable enqueue fails, the new user is rolled
   * back with it (AC-1 and AC-7). The legacy invitation event, when enabled
   * during rollout, is published only after the transaction commits.
   */
  async create(
    input: CreateUserInput,
    actor: UserActor,
    correlation: RequestCorrelation,
  ): Promise<UserRecord> {
    const database = this.requireDatabase();
    const created = await withTransaction(database, async (transaction) => {
      const conflict = await this.repository.findCreateConflict(
        input,
        transaction,
      );

      if (conflict === 'id_taken') {
        throw new ConflictError(
          'A user with this id already exists',
          'user_id_taken',
        );
      }

      if (conflict === 'email_taken') {
        throw new ConflictError(
          'A user with this email already exists',
          'user_email_taken',
        );
      }

      const user = await this.repository.insert(input, transaction);

      await this.writeAudit({
        action: 'create',
        user,
        actor,
        correlation,
        transaction,
        statusBefore: null,
        statusAfter: user.status,
        beforeState: null,
        afterState: user,
        changeSummary: 'user created',
      });

      if (this.durableJobsEnabled) {
        if (!this.jobs) {
          throw new Error('durable jobs registry is not configured');
        }

        await enqueueJob(transaction, this.jobs, {
          type: authSendUserInvitationContract.type,
          version: authSendUserInvitationContract.version,
          payload: { userId: user.id },
          sourceService: authSendUserInvitationContract.sourceService,
          targetService: authSendUserInvitationContract.targetService,
          idempotencyKey: `user-invitation:${user.id}`,
          actorUserId: actor.id,
          correlationId: correlation.requestId,
        });
      }

      return user;
    });

    if (!this.durableJobsEnabled) {
      this.publishInvitation(created, actor);
    }

    return created;
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actor: UserActor,
    correlation: RequestCorrelation,
  ): Promise<UserRecord> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const before = await this.repository.findByIdForUpdate(id, transaction);

      if (!before) {
        throw new NotFoundError('User not found');
      }

      if (before.status === 'deleted') {
        throw new ConflictError(
          'A deleted user can only be restored',
          'user_deleted',
        );
      }

      const after = await this.repository.updateProfile(id, input, transaction);

      if (!after) {
        throw new NotFoundError('User not found');
      }

      await this.writeAudit({
        action: 'update',
        user: after,
        actor,
        correlation,
        transaction,
        statusBefore: before.status,
        statusAfter: after.status,
        beforeState: before,
        afterState: after,
        changeSummary: summarizeChange(before, after),
      });

      return after;
    });
  }

  /**
   * The six status actions share one path: lock the row, run the guards, apply
   * the timestamp patch, then audit. Every guard and the audit write live inside
   * the same transaction as the mutation.
   */
  async applyStatusAction(
    id: string,
    action: UserStatusAction,
    reason: string,
    actor: UserActor,
    correlation: RequestCorrelation,
  ): Promise<UserRecord> {
    const database = this.requireDatabase();
    const transition = TRANSITIONS[action];

    if (id === actor.id) {
      throw new ConflictError(
        'You cannot change the status of your own account',
        'self_action',
      );
    }

    return withTransaction(database, async (transaction) => {
      const before = await this.repository.findByIdForUpdate(id, transaction);

      if (!before) {
        throw new NotFoundError('User not found');
      }

      if (before.status === 'deleted' && action !== 'restore') {
        throw new ConflictError(
          'A deleted user can only be restored',
          'user_deleted',
        );
      }

      if (!transition.from.includes(before.status)) {
        throw new ConflictError(
          `Cannot ${action} a user whose status is ${before.status}`,
          'invalid_transition',
        );
      }

      const after = await this.repository.setStatusTimestamps(
        id,
        transition.patch,
        transaction,
      );

      if (!after) {
        throw new NotFoundError('User not found');
      }

      await this.writeAudit({
        action,
        user: after,
        actor,
        correlation,
        transaction,
        statusBefore: before.status,
        statusAfter: after.status,
        beforeState: before,
        afterState: after,
        changeSummary: summarizeChange(before, after),
        reason,
      });

      return after;
    });
  }

  async setTotpRequirement(
    id: string,
    required: boolean,
    reason: string,
    actor: UserActor,
    correlation: RequestCorrelation,
  ): Promise<{ ok: true }> {
    const database = this.requireDatabase();

    await withTransaction(database, async (transaction) => {
      const before = await this.repository.findByIdForUpdate(id, transaction);
      if (!before) throw new NotFoundError('User not found');
      const [beforeRequirement] = await transaction`
        SELECT totp_required_at
        FROM "user"."users"
        WHERE id = ${id}
      `;

      const updated = await this.repository.setTotpRequirement(
        id,
        required,
        transaction,
      );
      if (!updated) throw new NotFoundError('User not found');

      await this.writeAudit({
        action: required ? 'totp_require' : 'totp_unrequire',
        user: before,
        actor,
        correlation,
        transaction,
        statusBefore: null,
        statusAfter: null,
        beforeState: {
          totpRequired: beforeRequirement?.totp_required_at != null,
        },
        afterState: { totpRequired: required },
        changeSummary: required
          ? 'TOTP requirement enabled'
          : 'TOTP requirement disabled',
        reason,
      });
    });

    return { ok: true };
  }

  /**
   * Audit writes carry the actor's name, which the identity headers do not
   * include: the id from the verified identity names the row this service owns,
   * so the name is read from it here.
   */
  private async writeAudit(input: {
    action: string;
    user: UserRecord;
    actor: UserActor;
    correlation: RequestCorrelation;
    transaction: DatabaseClient;
    statusBefore: string | null;
    statusAfter: string | null;
    beforeState: unknown;
    afterState: unknown;
    changeSummary: string;
    reason?: string;
  }): Promise<void> {
    const actorRow = await this.repository.findById(
      input.actor.id,
      input.transaction,
    );

    await ActivityLog.writeAudit({
      action: input.action,
      module: 'users',
      entityType: 'user',
      entityId: input.user.id,
      entityLabel: input.user.email,
      statusBefore: input.statusBefore,
      statusAfter: input.statusAfter,
      reason: input.reason ?? null,
      changeSummary: input.changeSummary,
      beforeState: input.beforeState,
      afterState: input.afterState,
      actor: {
        id: input.actor.id,
        name: actorRow?.name ?? null,
        email: input.actor.email,
      },
      requestId: input.correlation.requestId,
      ipAddress: input.correlation.ipAddress,
      userAgent: input.correlation.userAgent,
    });
  }

  /**
   * Fire and forget by design (AC-2): a create that already committed must not
   * fail because NATS is down, so a missing publisher or a failed publish is
   * logged as a warning and the new user can still request a magic link.
   */
  private publishInvitation(user: UserRecord, actor: UserActor): void {
    const event: UserInvitedEvent = {
      type: 'user.invited',
      version: 1,
      occurredAt: new Date().toISOString(),
      userId: user.id,
      email: user.email,
      name: user.name,
      requestedBy: actor.id,
    };

    if (!this.messaging) {
      this.logger?.warn('user.invited.skipped', {
        userId: user.id,
        reason: 'messaging is not configured',
      });

      return;
    }

    try {
      this.messaging.publish(USER_INVITED_SUBJECT, event);
    } catch (error) {
      this.logger?.warn('user.invited.publish_failed', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requireDatabase(): DatabaseClient {
    if (!this.database) {
      throw new Error('user database is not configured');
    }

    return this.database;
  }
}
