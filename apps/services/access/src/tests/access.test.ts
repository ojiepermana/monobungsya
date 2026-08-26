import { describe, expect, it, spyOn } from 'bun:test';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import {
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  JobRegistry,
} from '#project/jobs';
import { ActivityLog } from '#project/logger';
import { createApp } from '../app';
import { loadAccessEnv } from '../config/env';
import { PermissionLookupCache } from '../modules/access/access.cache';
import { AccessRepository } from '../modules/access/access.repository';
import { AccessService } from '../modules/access/access.service';

const SECRET = 'access-test-signing-secret';
const USER_ID = '0198f8a0-0000-7000-8000-000000000001';

function headersFor(
  method: string,
  path: string,
  permissions: string[],
): Headers {
  const identity = {
    userId: USER_ID,
    email: 'admin@local.app',
    permissions,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return new Headers({
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': identity.permissions.join(','),
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity(method, path, identity, SECRET),
  });
}

describe('access service', () => {
  it('exposes health and denies unsigned catalog requests', async () => {
    const app = createApp(
      loadAccessEnv({
        NODE_ENV: 'test',
        PORT: '3104',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );

    const health = await app.handle(new Request('http://localhost/health'));
    const response = await app.handle(
      new Request('http://localhost/api/v1/access/permissions'),
    );

    expect(health.status).toBe(200);
    expect(response.status).toBe(401);
  });

  it('enforces access permissions before reaching the repository', async () => {
    const app = createApp(
      loadAccessEnv({
        NODE_ENV: 'test',
        PORT: '3104',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );

    const response = await app.handle(
      new Request('http://localhost/api/v1/access/permissions', {
        headers: headersFor('GET', '/api/v1/access/permissions', []),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('normalizes, caches, invalidates, and bounds permission lookups', async () => {
    let calls = 0;
    const repository = {
      lookupPermissions: async () => {
        calls += 1;
        return ['user:user:read', 'user:user:read', 'logs:log:read'];
      },
    } as unknown as AccessRepository;
    const cache = new PermissionLookupCache(repository, 60_000, 1);

    expect(await cache.get('user-a')).toEqual([
      'logs:log:read',
      'user:user:read',
    ]);
    expect(await cache.get('user-a')).toEqual([
      'logs:log:read',
      'user:user:read',
    ]);
    expect(calls).toBe(1);

    cache.invalidate('user-a');
    await cache.get('user-a');
    expect(calls).toBe(2);

    await cache.get('user-b');
    await cache.get('user-a');
    expect(calls).toBe(4);
  });

  it('rolls back a catalog create when its audit write fails', async () => {
    let persisted = false;
    const permission = {
      id: '0198f8a0-0000-7000-8000-0000000000aa',
      name: 'verify:permission:create',
      code: 'VERIFY_PERMISSION_CREATE',
      namespace: 'verify',
      resource: 'permission',
      action: 'create',
      scope: null,
      description: 'Verification permission',
      grantCount: 0,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const findPermission = spyOn(
      AccessRepository.prototype,
      'findPermissionByNameOrCode',
    ).mockResolvedValue(null);
    const createPermission = spyOn(
      AccessRepository.prototype,
      'createPermission',
    ).mockImplementation(async () => {
      persisted = true;
      return permission;
    });
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) => {
      try {
        return await operation(new AccessRepository());
      } catch (error) {
        persisted = false;
        throw error;
      }
    });
    const audit = spyOn(ActivityLog, 'writeAudit').mockRejectedValue(
      new Error('logs database is unreachable'),
    );

    try {
      const service = new AccessService({
        database: {} as DatabaseClient,
      });

      await expect(
        service.createPermission(
          { name: permission.name, description: permission.description },
          { id: USER_ID, email: 'admin@local.app' },
          {
            requestId: 'request-1',
            ipAddress: null,
            userAgent: null,
          },
        ),
      ).rejects.toThrow('logs database is unreachable');

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(findPermission).toHaveBeenCalledTimes(1);
      expect(createPermission).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledTimes(1);
      expect(persisted).toBe(false);
    } finally {
      transaction.mockRestore();
      createPermission.mockRestore();
      findPermission.mockRestore();
      audit.mockRestore();
    }
  });

  it('rolls back a permission grant when its audit write fails', async () => {
    let persisted = false;
    const permission = {
      id: '0198f8a0-0000-7000-8000-0000000000ab',
      name: 'user:user:read',
      code: 'USER_USER_READ',
      namespace: 'user',
      resource: 'user',
      action: 'read',
      scope: null,
      description: 'Read users',
      grantCount: 0,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const findPermissions = spyOn(
      AccessRepository.prototype,
      'findPermissionsByIds',
    ).mockResolvedValue([permission]);
    const existingGrants = spyOn(
      AccessRepository.prototype,
      'existingGrantPermissionIds',
    ).mockResolvedValue([]);
    const insertGrant = spyOn(
      AccessRepository.prototype,
      'insertGrant',
    ).mockImplementation(async () => {
      persisted = true;
      return '0198f8a0-0000-7000-8000-0000000000ac';
    });
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) => {
      try {
        return await operation(new AccessRepository());
      } catch (error) {
        persisted = false;
        throw error;
      }
    });
    const audit = spyOn(ActivityLog, 'writeAudit').mockRejectedValue(
      new Error('logs database is unreachable'),
    );

    try {
      const service = new AccessService({
        database: {} as DatabaseClient,
      });

      await expect(
        service.grantPermissions(
          '0198f8a0-0000-7000-8000-0000000000ad',
          [permission.id],
          { id: USER_ID, email: 'admin@local.app' },
          { requestId: 'request-2', ipAddress: null, userAgent: null },
        ),
      ).rejects.toThrow('logs database is unreachable');

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(findPermissions).toHaveBeenCalledTimes(1);
      expect(existingGrants).toHaveBeenCalledTimes(1);
      expect(insertGrant).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledTimes(1);
      expect(persisted).toBe(false);
    } finally {
      transaction.mockRestore();
      insertGrant.mockRestore();
      existingGrants.mockRestore();
      findPermissions.mockRestore();
      audit.mockRestore();
    }
  });

  it('publishes a grant invalidation only after the transaction commits', async () => {
    let committed = false;
    let publishedAfterCommit = false;
    const permission = {
      id: '0198f8a0-0000-7000-0000-0000000000ae',
      name: 'user:user:read',
      code: 'USER_USER_READ',
      namespace: 'user',
      resource: 'user',
      action: 'read',
      scope: null,
      description: 'Read users',
      grantCount: 0,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const findPermissions = spyOn(
      AccessRepository.prototype,
      'findPermissionsByIds',
    ).mockResolvedValue([permission]);
    const existingGrants = spyOn(
      AccessRepository.prototype,
      'existingGrantPermissionIds',
    ).mockResolvedValue([]);
    const insertGrant = spyOn(
      AccessRepository.prototype,
      'insertGrant',
    ).mockResolvedValue('0198f8a0-0000-7000-0000-0000000000af');
    const audit = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) => {
      const result = await operation(new AccessRepository());
      committed = true;
      return result;
    });
    const messaging = {
      publish() {
        publishedAfterCommit = committed;
      },
    };

    try {
      const service = new AccessService({
        database: {} as DatabaseClient,
        messaging,
      });

      await service.grantPermissions(
        '0198f8a0-0000-7000-0000000000b0',
        [permission.id],
        { id: USER_ID, email: 'admin@local.app' },
        { requestId: 'request-3', ipAddress: null, userAgent: null },
      );

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledTimes(1);
      expect(publishedAfterCommit).toBe(true);
    } finally {
      transaction.mockRestore();
      insertGrant.mockRestore();
      existingGrants.mockRestore();
      findPermissions.mockRestore();
      audit.mockRestore();
    }
  });

  it('keeps update, delete, and revoke audit failures inside their transactions', async () => {
    let rollbacks = 0;
    const permission = {
      id: '0198f8a0-0000-7000-0000-0000000000b1',
      name: 'user:user:read',
      code: 'USER_USER_READ',
      namespace: 'user',
      resource: 'user',
      action: 'read',
      scope: null,
      description: 'Read users',
      grantCount: 0,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const findPermission = spyOn(
      AccessRepository.prototype,
      'findPermission',
    ).mockResolvedValue(permission);
    const updateDescription = spyOn(
      AccessRepository.prototype,
      'updateDescription',
    ).mockResolvedValue(permission);
    const deletePermission = spyOn(
      AccessRepository.prototype,
      'deletePermission',
    ).mockResolvedValue(true);
    const permissionForGrant = spyOn(
      AccessRepository.prototype,
      'permissionForGrant',
    ).mockResolvedValue(permission);
    const revokeGrant = spyOn(
      AccessRepository.prototype,
      'revokeGrant',
    ).mockResolvedValue(true);
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) => {
      try {
        return await operation(new AccessRepository());
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    });
    const audit = spyOn(ActivityLog, 'writeAudit').mockRejectedValue(
      new Error('logs database is unreachable'),
    );
    const actor = { id: USER_ID, email: 'admin@local.app' };
    const correlation = {
      requestId: 'request-4',
      ipAddress: null,
      userAgent: null,
    };

    try {
      const service = new AccessService({ database: {} as DatabaseClient });

      await expect(
        service.updatePermission(permission.id, 'Updated', actor, correlation),
      ).rejects.toThrow('logs database is unreachable');
      await expect(
        service.deletePermission(permission.id, actor, correlation),
      ).rejects.toThrow('logs database is unreachable');
      await expect(
        service.revokePermission(
          '0198f8a0-0000-7000-0000000000b2',
          permission.id,
          actor,
          correlation,
        ),
      ).rejects.toThrow('logs database is unreachable');

      expect(transaction).toHaveBeenCalledTimes(3);
      expect(audit).toHaveBeenCalledTimes(3);
      expect(rollbacks).toBe(3);
    } finally {
      transaction.mockRestore();
      revokeGrant.mockRestore();
      permissionForGrant.mockRestore();
      deletePermission.mockRestore();
      updateDescription.mockRestore();
      findPermission.mockRestore();
      audit.mockRestore();
    }
  });

  it('AC-4 and AC-6 enqueue access notifications and capability sync after durable validation', async () => {
    const permission = {
      id: '0198f8a0-0000-7000-8000-0000000000b3',
      name: 'jobs:job:read',
      code: 'JOBS_JOB_READ',
      namespace: 'jobs',
      resource: 'job',
      action: 'read',
      scope: null,
      description: 'Read jobs',
      grantCount: 0,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const enqueueValues: unknown[][] = [];
    const database = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      if (strings.raw.join('?').includes('jobs.enqueue_job'))
        enqueueValues.push(values);
      return [{ id: '0198f8a0-0000-7000-8000-0000000000b4' }];
    }) as unknown as DatabaseClient;
    const findPermissions = spyOn(
      AccessRepository.prototype,
      'findPermissionsByIds',
    ).mockResolvedValue([permission]);
    const existingGrants = spyOn(
      AccessRepository.prototype,
      'existingGrantPermissionIds',
    ).mockResolvedValue([]);
    const insertGrant = spyOn(
      AccessRepository.prototype,
      'insertGrant',
    ).mockResolvedValue('0198f8a0-0000-7000-8000-0000000000b5');
    const lookupPermissions = spyOn(
      AccessRepository.prototype,
      'lookupPermissions',
    ).mockResolvedValue(['jobs:job:read']);
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) =>
      operation(new AccessRepository(database), database),
    );
    const audit = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    const jobs = new JobRegistry();
    jobs.registerContract(accessNotificationCreateContract);
    jobs.registerContract(accessNotificationRecipientCapabilitySyncContract);

    try {
      const service = new AccessService({
        database,
        jobs,
        durableJobsEnabled: true,
      });

      const result = await service.grantPermissions(
        USER_ID,
        [permission.id],
        { id: USER_ID, email: 'admin@local.app' },
        { requestId: 'request-durable', ipAddress: null, userAgent: null },
      );

      expect(result.granted).toEqual([permission.id]);
      expect(enqueueValues.map((values) => values[0])).toEqual([
        accessNotificationCreateContract.type,
        accessNotificationRecipientCapabilitySyncContract.type,
      ]);
      expect(enqueueValues[1]?.[2]).toEqual({
        userId: USER_ID,
        canReadJobs: true,
        canReadObservability: false,
      });
      expect(lookupPermissions).toHaveBeenCalledWith(USER_ID);
    } finally {
      audit.mockRestore();
      transaction.mockRestore();
      lookupPermissions.mockRestore();
      insertGrant.mockRestore();
      existingGrants.mockRestore();
      findPermissions.mockRestore();
    }
  });

  it('AC-3 rejects a normalized duplicate when the existing group is deleted', async () => {
    const findGroupByName = spyOn(
      AccessRepository.prototype,
      'findGroupByName',
    ).mockResolvedValue({
      id: 'group-deleted',
      deletedAt: '2026-08-25T00:00:00.000Z',
    });
    const createGroup = spyOn(
      AccessRepository.prototype,
      'createGroup',
    ).mockImplementation(async () => {
      throw new Error('should not create a duplicate');
    });
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) =>
      operation(new AccessRepository()),
    );

    try {
      const service = new AccessService({ database: {} as DatabaseClient });

      let error: unknown;
      try {
        await service.createGroup(
          { name: '  Operators  ' },
          { id: USER_ID, email: 'admin@local.app' },
          { requestId: 'group-duplicate', ipAddress: null, userAgent: null },
        );
      } catch (value) {
        error = value;
      }
      expect(error).toMatchObject({
        status: 409,
        reason: 'group_duplicate_deleted',
      });
      expect((error as Error).message).toContain(
        'already exists and is deleted; restore it instead',
      );
      expect(findGroupByName).toHaveBeenCalledWith('Operators');
      expect(createGroup).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
      createGroup.mockRestore();
      findGroupByName.mockRestore();
    }
  });

  it('AC-5 attaches group permissions idempotently and records permission names', async () => {
    const group = {
      id: 'group-1',
      name: 'Operators',
      status: 'active' as const,
      description: null,
      permissionCount: 1,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      deletedAt: null,
    };
    const permissions = [
      {
        id: 'permission-1',
        name: 'user:user:read',
        code: 'USER_USER_READ',
        namespace: 'user',
        resource: 'user',
        action: 'read',
        scope: null,
        description: 'Read users',
        grantCount: 0,
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
      {
        id: 'permission-2',
        name: 'user:user:update',
        code: 'USER_USER_UPDATE',
        namespace: 'user',
        resource: 'user',
        action: 'update',
        scope: null,
        description: 'Update users',
        grantCount: 0,
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    ];
    const findGroup = spyOn(
      AccessRepository.prototype,
      'findGroup',
    ).mockResolvedValue(group);
    const findPermissions = spyOn(
      AccessRepository.prototype,
      'findPermissionsByIds',
    ).mockResolvedValue(permissions);
    const existing = spyOn(
      AccessRepository.prototype,
      'existingGroupPermissionIds',
    ).mockResolvedValue(['permission-2']);
    const attach = spyOn(
      AccessRepository.prototype,
      'attachGroupPermission',
    ).mockResolvedValue(true);
    const audit = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) =>
      operation(new AccessRepository()),
    );

    try {
      const service = new AccessService({ database: {} as DatabaseClient });
      const result = await service.attachGroupPermissions(
        group.id,
        ['permission-1', 'permission-2'],
        { id: USER_ID, email: 'admin@local.app' },
        { requestId: 'group-attach', ipAddress: null, userAgent: null },
      );

      expect(result).toEqual({
        attached: ['permission-1'],
        skipped: ['permission-2'],
      });
      expect(existing).toHaveBeenCalledWith(group.id, [
        'permission-1',
        'permission-2',
      ]);
      expect(attach).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0]?.[0]).toMatchObject({
        action: 'attach_permission',
        entityType: 'group',
        metadata: {
          permissionNames: ['user:user:read', 'user:user:update'],
          attached: ['permission-1'],
          skipped: ['permission-2'],
        },
      });
    } finally {
      transaction.mockRestore();
      audit.mockRestore();
      attach.mockRestore();
      existing.mockRestore();
      findPermissions.mockRestore();
      findGroup.mockRestore();
    }
  });

  it('AC-6 blocks off and empty groups before attempting to grant access', async () => {
    const group = {
      id: 'group-1',
      name: 'Operators',
      status: 'off' as const,
      description: null,
      permissionCount: 1,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      deletedAt: null,
    };
    const findGroup = spyOn(
      AccessRepository.prototype,
      'findGroup',
    ).mockResolvedValue(group);
    const listGroupPermissions = spyOn(
      AccessRepository.prototype,
      'listGroupPermissions',
    ).mockResolvedValue([]);
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) =>
      operation(new AccessRepository()),
    );

    try {
      const service = new AccessService({ database: {} as DatabaseClient });
      await expect(
        service.applyGroupToUser(
          USER_ID,
          group.id,
          { id: USER_ID, email: 'admin@local.app' },
          { requestId: 'group-off', ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ status: 409, reason: 'group_not_appliable' });

      findGroup.mockResolvedValue({ ...group, status: 'active' });
      await expect(
        service.applyGroupToUser(
          USER_ID,
          group.id,
          { id: USER_ID, email: 'admin@local.app' },
          { requestId: 'group-empty', ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(listGroupPermissions).toHaveBeenCalledTimes(1);
    } finally {
      transaction.mockRestore();
      listGroupPermissions.mockRestore();
      findGroup.mockRestore();
    }
  });

  it('AC-7 applies a group additively, skips existing grants, and publishes one event', async () => {
    const group = {
      id: 'group-1',
      name: 'Operators',
      status: 'active' as const,
      description: null,
      permissionCount: 2,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      deletedAt: null,
    };
    const permissions = [
      {
        id: 'permission-1',
        name: 'user:user:read',
        code: 'USER_USER_READ',
        namespace: 'user',
        resource: 'user',
        action: 'read',
        scope: null,
        description: 'Read users',
        grantCount: 0,
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
      {
        id: 'permission-2',
        name: 'user:user:update',
        code: 'USER_USER_UPDATE',
        namespace: 'user',
        resource: 'user',
        action: 'update',
        scope: null,
        description: 'Update users',
        grantCount: 0,
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    ];
    const findGroup = spyOn(
      AccessRepository.prototype,
      'findGroup',
    ).mockResolvedValue(group);
    const listGroupPermissions = spyOn(
      AccessRepository.prototype,
      'listGroupPermissions',
    ).mockResolvedValue(permissions);
    const existing = spyOn(
      AccessRepository.prototype,
      'existingGrantPermissionIds',
    ).mockResolvedValue(['permission-2']);
    const insertGrant = spyOn(
      AccessRepository.prototype,
      'insertGrant',
    ).mockResolvedValue('grant-1');
    const audit = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    const published: unknown[] = [];
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) =>
      operation(new AccessRepository()),
    );

    try {
      const service = new AccessService({
        database: {} as DatabaseClient,
        messaging: {
          publish: (_subject, event) => published.push(event),
        },
      });
      const result = await service.applyGroupToUser(
        USER_ID,
        group.id,
        { id: USER_ID, email: 'admin@local.app' },
        { requestId: 'group-apply', ipAddress: null, userAgent: null },
      );

      expect(result).toEqual({
        granted: ['permission-1'],
        skipped: ['permission-2'],
      });
      expect(audit.mock.calls[0]?.[0]).toMatchObject({
        action: 'apply',
        entityType: 'permission_user',
        metadata: {
          groupId: group.id,
          permissionNames: ['user:user:read'],
          granted: ['permission-1'],
          skipped: ['permission-2'],
        },
      });
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        type: 'access.permission.changed',
        userId: USER_ID,
      });
    } finally {
      transaction.mockRestore();
      audit.mockRestore();
      insertGrant.mockRestore();
      existing.mockRestore();
      listGroupPermissions.mockRestore();
      findGroup.mockRestore();
    }
  });

  it('AC-8 isolates a failed bulk user and continues applying to later users', async () => {
    const group = {
      id: 'group-1',
      name: 'Operators',
      status: 'active' as const,
      description: null,
      permissionCount: 1,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      deletedAt: null,
    };
    const permission = {
      id: 'permission-1',
      name: 'user:user:read',
      code: 'USER_USER_READ',
      namespace: 'user',
      resource: 'user',
      action: 'read',
      scope: null,
      description: 'Read users',
      grantCount: 0,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const userOne = '0198f8a0-0000-7000-8000-000000000101';
    const userTwo = '0198f8a0-0000-7000-8000-000000000102';
    const findGroup = spyOn(
      AccessRepository.prototype,
      'findGroup',
    ).mockResolvedValue(group);
    const listGroupPermissions = spyOn(
      AccessRepository.prototype,
      'listGroupPermissions',
    ).mockResolvedValue([permission]);
    const existing = spyOn(
      AccessRepository.prototype,
      'existingGrantPermissionIds',
    ).mockResolvedValue([]);
    const insertGrant = spyOn(
      AccessRepository.prototype,
      'insertGrant',
    ).mockImplementation(async (userId) => {
      if (userId === userTwo) throw new Error('database rejected this user');
      return 'grant-1';
    });
    const audit = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    const transaction = spyOn(
      AccessRepository.prototype,
      'transaction',
    ).mockImplementation(async (operation) =>
      operation(new AccessRepository()),
    );

    try {
      const service = new AccessService({ database: {} as DatabaseClient });
      const result = await service.applyGroupToUsers(
        group.id,
        [userOne, userTwo],
        { id: USER_ID, email: 'admin@local.app' },
        { requestId: 'group-bulk', ipAddress: null, userAgent: null },
      );

      expect(result.applied).toEqual([
        { userId: userOne, granted: ['permission-1'], skipped: [] },
      ]);
      expect(result.failed).toEqual([
        {
          userId: userTwo,
          reason: 'Could not apply permission group to this user',
        },
      ]);
      expect(transaction).toHaveBeenCalledTimes(3);
      expect(audit).toHaveBeenCalledTimes(1);
    } finally {
      transaction.mockRestore();
      audit.mockRestore();
      insertGrant.mockRestore();
      existing.mockRestore();
      listGroupPermissions.mockRestore();
      findGroup.mockRestore();
    }
  });

  it('AC-11 denies group list requests without the group list permission', async () => {
    const app = createApp(
      loadAccessEnv({
        NODE_ENV: 'test',
        PORT: '3104',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );

    const response = await app.handle(
      new Request('http://localhost/api/v1/access/groups', {
        headers: headersFor('GET', '/api/v1/access/groups', []),
      }),
    );

    expect(response.status).toBe(403);
  });
});
