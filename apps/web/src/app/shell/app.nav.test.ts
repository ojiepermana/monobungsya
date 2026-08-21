import { describe, expect, it } from 'vitest';
import type { NavigationItem } from '@ojiepermana/angular/navigation';
import { appNavigationFor } from './app.nav';

describe('application navigation authorization', () => {
  it('keeps user access and logs available to authorized users', () => {
    expect(navigationIds(appNavigationFor(['users.manage', 'logs.read']))).toEqual([
      'logs-overview',
      'users',
      'logs-audit',
      'logs-access',
      'logs-application',
    ]);
  });

  it('does not expose user administration without its permission', () => {
    expect(navigationIds(appNavigationFor(['logs.read']))).not.toContain('users');
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
