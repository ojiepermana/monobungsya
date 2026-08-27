import type { NavigationItem } from '@ojiepermana/angular/navigation';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../auth/permissions';
import { appNavigationFor } from './app.nav';

describe('application navigation authorization', () => {
  it('keeps user management and logs available to authorized users', () => {
    // User management is its own group above Settings: it is a domain area,
    // not a preference (spec docs/specs/0007-user-management).
    expect(
      navigationIds(
        appNavigationFor([
          PERMISSIONS.userUserManage,
          PERMISSIONS.logsLogRead,
          PERMISSIONS.accessPermissionManage,
        ]),
      ),
    ).toEqual([
      'logs-overview',
      'notifications',
      'users',
      'passkeys',
      'permissions',
      'groups',
      'logs-audit',
    ]);
  });

  it('does not expose user administration without its permission', () => {
    expect(
      navigationIds(appNavigationFor([PERMISSIONS.logsLogRead])),
    ).not.toContain('users');
  });

  it('does not expose any logs destination without the logs read permission (covers AC-5)', () => {
    const ids = navigationIds(appNavigationFor([PERMISSIONS.userUserManage]));

    expect(ids).not.toContain('logs-audit');

    const unprivileged = navigationIds(appNavigationFor([]));
    expect(unprivileged).not.toContain('logs-audit');
  });

  it('lets every signed in user manage their own passkeys', () => {
    expect(navigationIds(appNavigationFor([]))).toContain('passkeys');
    expect(
      navigationIds(appNavigationFor([PERMISSIONS.logsLogRead])),
    ).toContain('passkeys');
  });

  it('does not expose deleted feature destinations', () => {
    const ids = navigationIds(
      appNavigationFor([PERMISSIONS.userUserManage, PERMISSIONS.logsLogRead]),
    );

    expect(ids).not.toContain('dashboard');
  });
});

function navigationIds(items: readonly NavigationItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.id ? [item.id] : []),
    ...navigationIds(item.children ?? []),
  ]);
}
