import { derivePermissionParts } from '#project/acl';
import {
  ACCESS_PERMISSION_CHANGED_SUBJECT,
  type AccessPermissionChangedEvent,
} from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '#project/errors';
import {
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  enqueueJob,
  type JobRegistry,
} from '#project/jobs';
import { ActivityLog } from '#project/logger';
import type { Publisher } from '#project/messaging';
import { PermissionLookupCache } from './access.cache';
import { AccessRepository } from './access.repository';
import type {
  AccessActor,
  AccessCorrelation,
  GroupApplyResult,
  GroupBulkApplyResult,
  GroupListQuery,
  GroupListResult,
  GroupMutationResult,
  GroupRecord,
  GroupStatus,
  PermissionListQuery,
  PermissionListResult,
  PermissionRecord,
} from './access.types';

export interface AccessServiceOptions {
  database?: DatabaseClient;
  messaging?: Publisher;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  jobs?: JobRegistry;
  durableJobsEnabled?: boolean;
}

export class AccessService {
  private readonly repository: AccessRepository;
  private readonly cache: PermissionLookupCache;
  private readonly jobs?: JobRegistry;
  private readonly durableJobsEnabled: boolean;

  constructor(options: AccessServiceOptions = {}) {
    this.repository = new AccessRepository(options.database);
    this.cache = new PermissionLookupCache(
      this.repository,
      options.cacheTtlMs ?? 300_000,
      options.cacheMaxEntries ?? 1_000,
    );
    this.messaging = options.messaging;
    this.jobs = options.jobs;
    this.durableJobsEnabled = options.durableJobsEnabled ?? false;
  }

  private readonly messaging?: Publisher;

  async lookupPermissions(userId: string): Promise<string[]> {
    return this.cache.get(userId);
  }

  listPermissions(query: PermissionListQuery): Promise<PermissionListResult> {
    return this.repository.listPermissions(query);
  }

  async getPermission(id: string): Promise<PermissionRecord> {
    const permission = await this.repository.findPermission(id);
    if (!permission) throw new NotFoundError('Permission not found');
    return permission;
  }

  listGroups(query: GroupListQuery): Promise<GroupListResult> {
    return this.repository.listGroups(query);
  }

  async getGroup(id: string): Promise<GroupRecord> {
    const group = await this.repository.findGroup(id);
    if (!group) throw new NotFoundError('Permission group not found');
    return group;
  }

  async createGroup(
    input: {
      name: string;
      description?: string | null;
      status?: GroupStatus;
    },
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<GroupRecord> {
    const name = normalizeGroupName(input.name);
    if (!name) throw new ValidationError('Group name is required');

    return this.repository.transaction(async (repository) => {
      await assertGroupNameAvailable(repository, name);
      try {
        const group = await repository.createGroup({
          name,
          description: normalizeDescription(input.description),
          status: input.status,
        });
        await this.auditGroup('create', group, actor, correlation, {
          afterState: group,
          changeSummary: `created ${group.name}`,
        });
        return group;
      } catch (error) {
        throw mapGroupUniqueViolation(error, name);
      }
    });
  }

  async updateGroup(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      status?: GroupStatus;
    },
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<GroupRecord> {
    const hasInput =
      input.name !== undefined ||
      input.description !== undefined ||
      input.status !== undefined;
    if (!hasInput)
      throw new ValidationError('At least one group field is required');

    return this.repository.transaction(async (repository) => {
      const before = await repository.findGroup(id);
      if (!before) throw new NotFoundError('Permission group not found');
      const name =
        input.name === undefined ? undefined : normalizeGroupName(input.name);
      if (input.name !== undefined && !name) {
        throw new ValidationError('Group name is required');
      }
      if (name && name.toLowerCase() !== before.name.toLowerCase()) {
        await assertGroupNameAvailable(repository, name, id);
      }

      try {
        const updated = await repository.updateGroup(id, {
          name,
          description:
            input.description === undefined
              ? undefined
              : normalizeDescription(input.description),
          status: input.status,
        });
        if (!updated) throw new NotFoundError('Permission group not found');
        await this.auditGroup('update', updated, actor, correlation, {
          beforeState: before,
          afterState: updated,
          changeSummary: `updated ${updated.name}`,
        });
        return updated;
      } catch (error) {
        throw mapGroupUniqueViolation(error, name ?? before.name);
      }
    });
  }

  async deleteGroup(
    id: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const before = await repository.findGroup(id);
      if (!before) throw new NotFoundError('Permission group not found');
      if (before.deletedAt) {
        throw new ConflictError(
          'Permission group is already deleted',
          'group_already_deleted',
        );
      }
      const deleted = await repository.softDeleteGroup(id);
      if (!deleted) throw new NotFoundError('Permission group not found');
      await this.auditGroup('delete', deleted, actor, correlation, {
        beforeState: before,
        afterState: deleted,
        changeSummary: `deleted ${deleted.name}`,
      });
    });
  }

  async restoreGroup(
    id: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<GroupRecord> {
    return this.repository.transaction(async (repository) => {
      const before = await repository.findGroup(id);
      if (!before) throw new NotFoundError('Permission group not found');
      if (!before.deletedAt) {
        throw new ConflictError(
          'Permission group is not deleted',
          'group_not_deleted',
        );
      }
      const restored = await repository.restoreGroup(id);
      if (!restored) throw new NotFoundError('Permission group not found');
      await this.auditGroup('restore', restored, actor, correlation, {
        beforeState: before,
        afterState: restored,
        changeSummary: `restored ${restored.name}`,
      });
      return restored;
    });
  }

  async listGroupPermissions(id: string): Promise<PermissionRecord[]> {
    const group = await this.repository.findGroup(id);
    if (!group) throw new NotFoundError('Permission group not found');
    return this.repository.listGroupPermissions(id);
  }

  async attachGroupPermissions(
    id: string,
    permissionIds: string[],
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<GroupMutationResult> {
    return this.repository.transaction(async (repository) => {
      const group = await repository.findGroup(id);
      if (!group) throw new NotFoundError('Permission group not found');
      const uniqueIds = [...new Set(permissionIds)];
      const permissions = await repository.findPermissionsByIds(uniqueIds);
      if (permissions.length !== uniqueIds.length) {
        const known = new Set(permissions.map((permission) => permission.id));
        const missing = uniqueIds.find(
          (permissionId) => !known.has(permissionId),
        );
        throw new NotFoundError(`Permission ${missing ?? 'unknown'} not found`);
      }
      const existing = new Set(
        await repository.existingGroupPermissionIds(id, uniqueIds),
      );
      const attached: string[] = [];
      const skipped: string[] = [];
      for (const permissionId of uniqueIds) {
        if (existing.has(permissionId)) {
          skipped.push(permissionId);
          continue;
        }
        const inserted = await repository.attachGroupPermission(
          id,
          permissionId,
        );
        if (inserted) attached.push(permissionId);
        else skipped.push(permissionId);
      }
      await this.auditGroup('attach_permission', group, actor, correlation, {
        metadata: {
          permissionIds: uniqueIds,
          permissionNames: permissions.map((permission) => permission.name),
          attached,
          skipped,
        },
        changeSummary: `attached ${attached.length} permission(s) to ${group.name}`,
      });
      return { attached, skipped };
    });
  }

  async detachGroupPermission(
    id: string,
    permissionId: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const group = await repository.findGroup(id);
      if (!group) throw new NotFoundError('Permission group not found');
      const permission = await repository.findPermission(permissionId);
      if (!permission) throw new NotFoundError('Permission not found');
      if (!(await repository.detachGroupPermission(id, permissionId))) {
        throw new NotFoundError('Permission is not attached to this group');
      }
      await this.auditGroup('detach_permission', group, actor, correlation, {
        metadata: { permissionId, permissionName: permission.name },
        changeSummary: `detached ${permission.name} from ${group.name}`,
      });
    });
  }

  async applyGroupToUser(
    userId: string,
    groupId: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<GroupApplyResult> {
    const result = await this.repository.transaction(
      async (repository, transaction) => {
        const { group, permissions } = await this.requireApplicableGroup(
          repository,
          groupId,
        );
        const result = await this.applyPermissionIdsInTransaction(
          repository,
          transaction,
          userId,
          permissions.map((permission) => permission.id),
          permissions,
          actor,
          correlation,
        );
        await this.auditGroupApply(
          group,
          permissions,
          userId,
          result,
          actor,
          correlation,
        );
        return result;
      },
    );
    this.publish({ userId });
    return result;
  }

  async applyGroupToUsers(
    groupId: string,
    userIds: string[],
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<GroupBulkApplyResult> {
    const { group, permissions } = await this.repository.transaction(
      (repository) => this.requireApplicableGroup(repository, groupId),
    );
    const applied: GroupBulkApplyResult['applied'] = [];
    const failed: GroupBulkApplyResult['failed'] = [];

    for (const userId of userIds) {
      try {
        const result = await this.repository.transaction(
          async (repository, transaction) => {
            const appliedResult = await this.applyPermissionIdsInTransaction(
              repository,
              transaction,
              userId,
              permissions.map((permission) => permission.id),
              permissions,
              actor,
              correlation,
            );
            await this.auditGroupApply(
              group,
              permissions,
              userId,
              appliedResult,
              actor,
              correlation,
            );
            return appliedResult;
          },
        );
        applied.push({ userId, ...result });
        this.publish({ userId });
      } catch (error) {
        failed.push({ userId, reason: groupApplyFailureReason(error) });
      }
    }

    return { applied, failed };
  }

  async createPermission(
    input: { name: string; description?: string | null },
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<PermissionRecord> {
    const permission = await this.repository.transaction(async (repository) => {
      const parts = derivePermissionParts(input.name);
      if (!parts)
        throw new ValidationError('Permission name has an invalid format');
      const existing = await repository.findPermissionByNameOrCode(
        input.name,
        parts.code,
      );
      if (existing)
        throw new ConflictError(
          'A permission with this name or code already exists',
          'permission_duplicate',
        );

      const created = await repository.createPermission({
        name: input.name,
        ...parts,
        description: normalizeDescription(input.description),
      });
      await this.audit('create', created, actor, correlation, {
        afterState: created,
        changeSummary: `created ${created.name}`,
      });
      return created;
    });
    this.publish({});
    return permission;
  }

  async updatePermission(
    id: string,
    description: string | null | undefined,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<PermissionRecord> {
    const permission = await this.repository.transaction(async (repository) => {
      const before = await repository.findPermission(id);
      if (!before) throw new NotFoundError('Permission not found');
      const updated = await repository.updateDescription(
        id,
        normalizeDescription(description),
      );
      if (!updated) throw new NotFoundError('Permission not found');
      await this.audit('update', updated, actor, correlation, {
        beforeState: before,
        afterState: updated,
        changeSummary: `updated description for ${updated.name}`,
      });
      return updated;
    });
    this.publish({});
    return permission;
  }

  async deletePermission(
    id: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const permission = await repository.findPermission(id);
      if (!permission) throw new NotFoundError('Permission not found');
      if (permission.namespace === 'access') {
        throw new ForbiddenError(
          'Permissions in the access namespace cannot be deleted',
        );
      }
      if (!(await repository.deletePermission(id))) {
        throw new NotFoundError('Permission not found');
      }
      await this.audit('delete', permission, actor, correlation, {
        beforeState: permission,
        changeSummary: `deleted ${permission.name} with grants`,
      });
    });
    this.publish({});
  }

  listGrants(userId: string) {
    return this.repository.listGrants(userId);
  }

  async grantPermissions(
    userId: string,
    permissionIds: string[],
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<{ granted: string[]; skipped: string[] }> {
    const result = await this.repository.transaction(
      async (repository, transaction) => {
        const uniqueIds = [...new Set(permissionIds)];
        const duplicateIds = permissionIds.filter(
          (id, index) => permissionIds.indexOf(id) !== index,
        );
        const permissions = await repository.findPermissionsByIds(uniqueIds);
        if (permissions.length !== uniqueIds.length) {
          const known = new Set(permissions.map((permission) => permission.id));
          const missing = uniqueIds.find((id) => !known.has(id));
          throw new NotFoundError(
            `Permission ${missing ?? 'unknown'} not found`,
          );
        }
        const result = await this.applyPermissionIdsInTransaction(
          repository,
          transaction,
          userId,
          permissions.map((permission) => permission.id),
          permissions,
          actor,
          correlation,
          { duplicateIds, auditEachPermission: true },
        );
        return result;
      },
    );
    if (result.granted.length > 0) {
      this.publish({ userId });
    }
    return result;
  }

  async copyPermissions(
    userId: string,
    sourceUserId: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<{ granted: string[]; skipped: string[] }> {
    if (userId === sourceUserId) {
      throw new ValidationError(
        'Permissions cannot be copied from the same user',
      );
    }
    const permissionIds =
      await this.repository.sourcePermissionIds(sourceUserId);
    if (permissionIds.length === 0) return { granted: [], skipped: [] };
    return this.grantPermissions(userId, permissionIds, actor, correlation);
  }

  async revokePermission(
    userId: string,
    permissionId: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    await this.repository.transaction(async (repository, transaction) => {
      const permission = await repository.permissionForGrant(permissionId);
      if (!permission) throw new NotFoundError('Permission not found');
      if (userId === actor.id && permission.namespace === 'access') {
        throw new ForbiddenError(
          'You cannot revoke your own access administration permission',
        );
      }
      if (!(await repository.revokeGrant(userId, permissionId))) {
        throw new NotFoundError('Permission grant not found');
      }
      await this.audit('revoke', permission, actor, correlation, {
        entityType: 'permission_user',
        entityId: `${userId}:${permissionId}`,
        entityLabel: `${userId} · ${permission.name}`,
        metadata: { userId, permissionId },
        changeSummary: `revoked ${permission.name} from ${userId}`,
      });
      await this.enqueueNotification(
        transaction,
        userId,
        'revoke',
        permission.name,
        actor,
        correlation,
      );
      await this.enqueueRecipientCapabilitySync(
        transaction,
        repository,
        userId,
      );
    });
    this.publish({ userId });
  }

  private async requireApplicableGroup(
    repository: AccessRepository,
    groupId: string,
  ): Promise<{ group: GroupRecord; permissions: PermissionRecord[] }> {
    const group = await repository.findGroup(groupId);
    if (!group) throw new NotFoundError('Permission group not found');
    if (group.status !== 'active' || group.deletedAt) {
      throw new ConflictError(
        'Permission group is off or deleted and cannot be applied',
        'group_not_appliable',
      );
    }
    const permissions = await repository.listGroupPermissions(groupId);
    if (permissions.length === 0) {
      throw new ValidationError(
        'Permission group must contain at least one permission before it can be applied',
      );
    }
    return { group, permissions };
  }

  private async applyPermissionIdsInTransaction(
    repository: AccessRepository,
    transaction: DatabaseClient | undefined,
    userId: string,
    permissionIds: readonly string[],
    permissions: readonly PermissionRecord[],
    actor: AccessActor,
    correlation: AccessCorrelation,
    options: {
      duplicateIds?: readonly string[];
      auditEachPermission?: boolean;
    } = {},
  ): Promise<GroupApplyResult> {
    const permissionById = new Map(
      permissions.map((permission) => [permission.id, permission]),
    );
    const existing = new Set(
      await repository.existingGrantPermissionIds(userId, permissionIds),
    );
    const granted: string[] = [];
    const skipped = [...(options.duplicateIds ?? [])];

    for (const permissionId of permissionIds) {
      const permission = permissionById.get(permissionId);
      if (!permission) continue;
      if (existing.has(permission.id)) {
        skipped.push(permission.id);
        continue;
      }
      const inserted = await repository.insertGrant(userId, permission.id);
      if (!inserted) {
        skipped.push(permission.id);
        continue;
      }
      granted.push(permission.id);
      if (options.auditEachPermission) {
        await this.audit('grant', permission, actor, correlation, {
          entityType: 'permission_user',
          entityId: inserted,
          entityLabel: `${userId} · ${permission.name}`,
          metadata: { userId, permissionId: permission.id },
          changeSummary: `granted ${permission.name} to ${userId}`,
        });
      }
      await this.enqueueNotification(
        transaction,
        userId,
        'grant',
        permission.name,
        actor,
        correlation,
      );
    }

    await this.enqueueRecipientCapabilitySync(transaction, repository, userId);
    return { granted, skipped };
  }

  private async auditGroupApply(
    group: GroupRecord,
    permissions: readonly PermissionRecord[],
    userId: string,
    result: GroupApplyResult,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    const granted = new Set(result.granted);
    await this.auditGroup('apply', group, actor, correlation, {
      entityType: 'permission_user',
      entityId: `${userId}:${group.id}`,
      entityLabel: `${userId} · ${group.name}`,
      metadata: {
        userId,
        groupId: group.id,
        groupName: group.name,
        permissionNames: permissions
          .filter((permission) => granted.has(permission.id))
          .map((permission) => permission.name),
        granted: result.granted,
        skipped: result.skipped,
      },
      changeSummary: `applied ${group.name} to ${userId} (${result.granted.length} granted, ${result.skipped.length} skipped)`,
    });
  }

  private async audit(
    action: string,
    permission: PermissionRecord,
    actor: AccessActor,
    correlation: AccessCorrelation,
    options: {
      entityType?: string;
      entityId?: string;
      entityLabel?: string;
      metadata?: unknown;
      beforeState?: unknown;
      afterState?: unknown;
      changeSummary?: string;
    },
  ): Promise<void> {
    await ActivityLog.writeAudit({
      action,
      module: 'access',
      entityType: options.entityType ?? 'permission',
      entityId: options.entityId ?? permission.id,
      entityLabel: options.entityLabel ?? permission.name,
      beforeState: options.beforeState,
      afterState: options.afterState,
      metadata: options.metadata,
      changeSummary: options.changeSummary,
      actor: { id: actor.id, email: actor.email },
      requestId: correlation.requestId,
      ipAddress: correlation.ipAddress,
      userAgent: correlation.userAgent,
    });
  }

  private async auditGroup(
    action: string,
    group: GroupRecord,
    actor: AccessActor,
    correlation: AccessCorrelation,
    options: {
      entityType?: string;
      entityId?: string;
      entityLabel?: string;
      metadata?: unknown;
      beforeState?: unknown;
      afterState?: unknown;
      changeSummary?: string;
    },
  ): Promise<void> {
    await ActivityLog.writeAudit({
      action,
      module: 'access',
      entityType: options.entityType ?? 'group',
      entityId: options.entityId ?? group.id,
      entityLabel: options.entityLabel ?? group.name,
      beforeState: options.beforeState,
      afterState: options.afterState,
      metadata: options.metadata,
      changeSummary: options.changeSummary,
      actor: { id: actor.id, email: actor.email },
      requestId: correlation.requestId,
      ipAddress: correlation.ipAddress,
      userAgent: correlation.userAgent,
    });
  }

  private publish(
    payload: Omit<
      AccessPermissionChangedEvent,
      'type' | 'version' | 'occurredAt'
    >,
  ): void {
    this.messaging?.publish(ACCESS_PERMISSION_CHANGED_SUBJECT, {
      type: 'access.permission.changed',
      version: 1,
      occurredAt: new Date().toISOString(),
      ...payload,
    } satisfies AccessPermissionChangedEvent);
    if (payload.userId) this.cache.invalidate(payload.userId);
    else this.cache.invalidate();
  }

  private async enqueueNotification(
    transaction: DatabaseClient | undefined,
    userId: string,
    action: 'grant' | 'revoke',
    permissionName: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    if (!this.durableJobsEnabled || !this.jobs || !transaction) return;
    const occurredAt = new Date().toISOString();
    await enqueueJob(transaction, this.jobs, {
      type: accessNotificationCreateContract.type,
      version: accessNotificationCreateContract.version,
      payload: {
        userId,
        type: 'access.permission_changed',
        version: 1,
        payload: {
          action: action === 'grant' ? 'diberikan' : 'dicabut',
          permissionName,
        },
        occurredAt,
        correlationId: correlation.requestId,
      },
      sourceService: accessNotificationCreateContract.sourceService,
      targetService: accessNotificationCreateContract.targetService,
      idempotencyKey: `permission:${userId}:${action}:${permissionName}:${correlation.requestId ?? occurredAt}`,
      actorUserId: actor.id,
      correlationId: correlation.requestId,
    });
  }

  private async enqueueRecipientCapabilitySync(
    transaction: DatabaseClient | undefined,
    repository: AccessRepository,
    userId: string,
  ): Promise<void> {
    if (!this.durableJobsEnabled || !this.jobs || !transaction) return;
    const permissions = await repository.lookupPermissions(userId);
    const canReadJobs = permissions.some(
      (permission) =>
        permission === 'jobs:job:read' || permission === 'jobs:job:manage',
    );
    const canReadObservability = permissions.includes(
      'observability:telemetry:read',
    );
    await enqueueJob(transaction, this.jobs, {
      type: accessNotificationRecipientCapabilitySyncContract.type,
      version: accessNotificationRecipientCapabilitySyncContract.version,
      payload: { userId, canReadJobs, canReadObservability },
      sourceService:
        accessNotificationRecipientCapabilitySyncContract.sourceService,
      targetService:
        accessNotificationRecipientCapabilitySyncContract.targetService,
      idempotencyKey: `recipient-capability:${userId}:${canReadJobs}`,
      actorUserId: null,
    });
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  const description = value?.trim();
  return description ? description : null;
}

function normalizeGroupName(value: string | undefined): string {
  return value?.trim() ?? '';
}

async function assertGroupNameAvailable(
  repository: AccessRepository,
  name: string,
  excludedId?: string,
): Promise<void> {
  const existing = await repository.findGroupByName(name);
  if (!existing || existing.id === excludedId) return;
  if (existing.deletedAt) {
    throw new ConflictError(
      `A permission group named "${name}" already exists and is deleted; restore it instead`,
      'group_duplicate_deleted',
    );
  }
  throw new ConflictError(
    `A permission group named "${name}" already exists`,
    'group_duplicate',
  );
}

function mapGroupUniqueViolation(error: unknown, name: string): unknown {
  if (!isUniqueViolation(error)) return error;
  return new ConflictError(
    `A permission group named "${name}" already exists`,
    'group_duplicate',
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function groupApplyFailureReason(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'Could not apply permission group to this user';
}
