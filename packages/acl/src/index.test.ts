import { describe, expect, test } from 'bun:test';
import type { KnownPermissionName } from './index';
import {
  hasAnyRequiredPermission,
  hasResolvedPermission,
  managePermissionFor,
  normalizePermissions,
  PERMISSION_CATALOG,
  PERMISSIONS,
} from './index';

describe('permission helpers', () => {
  test('normalizes trim, empty values, and duplicate names without reordering', () => {
    expect(
      normalizePermissions([
        ' user:user:read ',
        '',
        'user:user:read',
        'logs:log:read',
      ]),
    ).toEqual(['user:user:read', 'logs:log:read']);
  });

  test('accepts a comma separated header value', () => {
    expect(normalizePermissions(' user:user:read, logs:log:read, ')).toEqual([
      'user:user:read',
      'logs:log:read',
    ]);
  });

  test('resolves manage for the same resource only', () => {
    expect(managePermissionFor(PERMISSIONS.userUserCreate)).toBe(
      PERMISSIONS.userUserManage,
    );
    expect(
      hasResolvedPermission(
        [PERMISSIONS.userUserManage],
        PERMISSIONS.userUserCreate,
      ),
    ).toBe(true);
    expect(
      hasResolvedPermission(
        [PERMISSIONS.userUserManage],
        PERMISSIONS.logsLogRead,
      ),
    ).toBe(false);
    expect(
      hasAnyRequiredPermission(
        [PERMISSIONS.userUserManage],
        [PERMISSIONS.userUserCreate],
      ),
    ).toBe(true);
  });

  test('keeps permission group catalog entries in step with the constants (AC-2)', () => {
    const groupPermissions = [
      PERMISSIONS.accessGroupList,
      PERMISSIONS.accessGroupRead,
      PERMISSIONS.accessGroupCreate,
      PERMISSIONS.accessGroupUpdate,
      PERMISSIONS.accessGroupDelete,
      PERMISSIONS.accessGroupRestore,
      PERMISSIONS.accessGroupManage,
      PERMISSIONS.accessPermissionGroupList,
      PERMISSIONS.accessPermissionGroupCreate,
      PERMISSIONS.accessPermissionGroupDelete,
      PERMISSIONS.accessPermissionGroupManage,
    ];

    const expected = new Set<string>(groupPermissions);
    expect(
      PERMISSION_CATALOG.filter((entry) => expected.has(entry.name)).map(
        (entry) => entry.name,
      ),
    ).toEqual(groupPermissions);
  });

  test('keeps signal observability permissions in the catalog (AC-2)', () => {
    const signalPermissions: KnownPermissionName[] = [
      PERMISSIONS.observabilityTraceRead,
      PERMISSIONS.observabilityMetricRead,
      PERMISSIONS.observabilityBenchmarkRead,
      PERMISSIONS.observabilityAlertRead,
    ];

    expect(
      PERMISSION_CATALOG.filter((entry) =>
        signalPermissions.includes(entry.name),
      ).map((entry) => entry.name),
    ).toEqual(signalPermissions);
    expect(PERMISSIONS).not.toHaveProperty('observabilityTelemetryRead');
  });
});
