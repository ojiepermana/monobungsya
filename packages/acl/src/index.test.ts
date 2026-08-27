import { describe, expect, test } from 'bun:test';
import {
  hasAnyRequiredPermission,
  hasResolvedPermission,
  managePermissionFor,
  normalizePermissions,
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
});
