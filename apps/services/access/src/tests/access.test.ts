import { describe, expect, it, spyOn } from 'bun:test';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
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
});
