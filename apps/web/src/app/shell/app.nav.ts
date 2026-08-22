import type { NavigationItem } from '@ojiepermana/angular/navigation';
import type { AuthPermission } from '../auth/auth.service';

export const APP_BRAND_ICON = 'payments' as const;

/** Application navigation grouped by the main areas of the payroll app. */
export function appNavigationFor(
  permissions: readonly AuthPermission[],
): readonly NavigationItem[] {
  const overviewItems: NavigationItem[] = [
    {
      id: 'logs-overview',
      type: 'item',
      title: 'Log Overview',
      icon: 'summarize',
      link: '/',
      exactMatch: true,
    },
  ];

  const settingsItems: NavigationItem[] = [
    {
      id: 'passkeys',
      type: 'item',
      title: 'Passkey',
      icon: 'fingerprint',
      link: '/setting/passkeys',
    },
  ];

  // users.manage is admin only (spec 0007, AC-8), so a manager never sees a
  // menu entry the gateway would refuse.
  const userItems: NavigationItem[] = [];
  if (permissions.includes('users.manage')) {
    userItems.push({
      id: 'users',
      type: 'item',
      title: 'User Management',
      icon: 'admin_panel_settings',
      link: '/users',
    });
  }

  const logItems: NavigationItem[] = [];
  if (permissions.includes('logs.read')) {
    logItems.push(
      {
        id: 'logs-audit',
        type: 'item',
        title: 'Audit Logs',
        icon: 'history',
        link: '/logs/audit',
      },
      {
        id: 'logs-access',
        type: 'item',
        title: 'Access Logs',
        icon: 'login',
        link: '/logs/access',
      },
      {
        id: 'logs-application',
        type: 'item',
        title: 'Application Logs',
        icon: 'terminal',
        link: '/logs/application',
      },
    );
  }

  const group = (
    title: string,
    children: readonly NavigationItem[],
  ): NavigationItem => ({
    type: 'group',
    title,
    children,
  });

  return [
    group('Overview', overviewItems),
    ...(userItems.length > 0 ? [group('Users', userItems)] : []),
    ...(settingsItems.length > 0 ? [group('Settings', settingsItems)] : []),
    ...(logItems.length > 0 ? [group('Logs', logItems)] : []),
  ];
}
