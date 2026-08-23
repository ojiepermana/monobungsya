import { derivePermissionParts } from '#project/acl';
import {
  ACCESS_PERMISSION_CHANGED_SUBJECT,
  type AccessPermissionChangedEvent,
} from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '#project/errors';
import { ActivityLog } from '#project/logger';
import type { Publisher } from '#project/messaging';
import { PermissionLookupCache } from './access.cache';
import { AccessRepository } from './access.repository';
import type {
  AccessActor,
  AccessCorrelation,
  PermissionListQuery,
  PermissionListResult,
  PermissionRecord,
} from './access.types';

export interface AccessServiceOptions {
  database?: DatabaseClient;
  messaging?: Publisher;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
}

export class AccessService {
  private readonly repository: AccessRepository;
  private readonly cache: PermissionLookupCache;

  constructor(options: AccessServiceOptions = {}) {
    this.repository = new AccessRepository(options.database);
    this.cache = new PermissionLookupCache(
      this.repository,
      options.cacheTtlMs ?? 300_000,
      options.cacheMaxEntries ?? 1_000,
    );
    this.messaging = options.messaging;
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

  async createPermission(
    input: { name: string; description?: string | null },
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<PermissionRecord> {
    const parts = derivePermissionParts(input.name);
    if (!parts)
      throw new ValidationError('Permission name has an invalid format');
    const existing = await this.repository.findPermissionByNameOrCode(
      input.name,
      parts.code,
    );
    if (existing)
      throw new ConflictError(
        'A permission with this name or code already exists',
        'permission_duplicate',
      );

    const permission = await this.repository.createPermission({
      name: input.name,
      ...parts,
      description: normalizeDescription(input.description),
    });
    await this.audit('create', permission, actor, correlation, {
      afterState: permission,
      changeSummary: `created ${permission.name}`,
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
    const before = await this.getPermission(id);
    const permission = await this.repository.updateDescription(
      id,
      normalizeDescription(description),
    );
    if (!permission) throw new NotFoundError('Permission not found');
    await this.audit('update', permission, actor, correlation, {
      beforeState: before,
      afterState: permission,
      changeSummary: `updated description for ${permission.name}`,
    });
    this.publish({});
    return permission;
  }

  async deletePermission(
    id: string,
    actor: AccessActor,
    correlation: AccessCorrelation,
  ): Promise<void> {
    const permission = await this.getPermission(id);
    if (permission.namespace === 'access') {
      throw new ForbiddenError(
        'Permissions in the access namespace cannot be deleted',
      );
    }
    if (!(await this.repository.deletePermission(id))) {
      throw new NotFoundError('Permission not found');
    }
    await this.audit('delete', permission, actor, correlation, {
      beforeState: permission,
      changeSummary: `deleted ${permission.name} with grants`,
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
    const uniqueIds = [...new Set(permissionIds)];
    const duplicateIds = permissionIds.filter(
      (id, index) => permissionIds.indexOf(id) !== index,
    );
    const permissions = await this.repository.findPermissionsByIds(uniqueIds);
    if (permissions.length !== uniqueIds.length) {
      const known = new Set(permissions.map((permission) => permission.id));
      const missing = uniqueIds.find((id) => !known.has(id));
      throw new NotFoundError(`Permission ${missing ?? 'unknown'} not found`);
    }
    const existing = new Set(
      await this.repository.existingGrantPermissionIds(userId, uniqueIds),
    );
    const granted: string[] = [];
    const skipped = [...duplicateIds];

    for (const permission of permissions) {
      if (existing.has(permission.id)) {
        skipped.push(permission.id);
        continue;
      }
      const inserted = await this.repository.insertGrant(userId, permission.id);
      if (!inserted) {
        skipped.push(permission.id);
        continue;
      }
      granted.push(permission.id);
      await this.audit('grant', permission, actor, correlation, {
        entityType: 'permission_user',
        entityId: inserted,
        entityLabel: `${userId} · ${permission.name}`,
        metadata: { userId, permissionId: permission.id },
        changeSummary: `granted ${permission.name} to ${userId}`,
      });
      this.publish({ userId });
    }

    return { granted, skipped };
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
    const permission = await this.repository.permissionForGrant(permissionId);
    if (!permission) throw new NotFoundError('Permission not found');
    if (userId === actor.id && permission.namespace === 'access') {
      throw new ForbiddenError(
        'You cannot revoke your own access administration permission',
      );
    }
    if (!(await this.repository.revokeGrant(userId, permissionId))) {
      throw new NotFoundError('Permission grant not found');
    }
    await this.audit('revoke', permission, actor, correlation, {
      entityType: 'permission_user',
      entityId: `${userId}:${permissionId}`,
      entityLabel: `${userId} · ${permission.name}`,
      metadata: { userId, permissionId },
      changeSummary: `revoked ${permission.name} from ${userId}`,
    });
    this.publish({ userId });
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
}

function normalizeDescription(value: string | null | undefined): string | null {
  const description = value?.trim();
  return description ? description : null;
}
