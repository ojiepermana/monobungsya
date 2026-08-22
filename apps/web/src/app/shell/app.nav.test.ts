import type { NavigationItem } from '@ojiepermana/angular/navigation';
import { describe, expect, it } from 'vitest';
import { appNavigationFor } from './app.nav';

describe('application navigation authorization', () => {
  it('keeps user access and logs available to authorized users', () => {
    expect(
      navigationIds(appNavigationFor(['users.manage', 'logs.read'])),
    ).toEqual([
      'logs-overview',
      'passkeys',
      'users',
      'logs-audit',
      'logs-access',
      'logs-application',
    ]);
  });

  it('does not expose user administration without its permission', () => {
    expect(navigationIds(appNavigationFor(['logs.read']))).not.toContain(
      'users',
    );
  });

  it('does not expose any logs destination without logs.read (covers AC-5)', () => {
    const ids = navigationIds(appNavigationFor(['users.manage']));

    expect(ids).not.toContain('logs-audit');
    expect(ids).not.toContain('logs-access');
    expect(ids).not.toContain('logs-application');

    const unprivileged = navigationIds(appNavigationFor([]));
    expect(unprivileged).not.toContain('logs-audit');
    expect(unprivileged).not.toContain('logs-access');
    expect(unprivileged).not.toContain('logs-application');
  });

  it('lets every signed in user manage their own passkeys', () => {
    expect(navigationIds(appNavigationFor([]))).toContain('passkeys');
    expect(navigationIds(appNavigationFor(['logs.read']))).toContain(
      'passkeys',
    );
  });

  it('does not expose deleted feature destinations', () => {
    const ids = navigationIds(appNavigationFor(['users.manage', 'logs.read']));

    expect(ids).not.toContain('dashboard');
  });
});

function navigationIds(items: readonly NavigationItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.id ? [item.id] : []),
    ...navigationIds(item.children ?? []),
  ]);
}
