import type { NavigationItem } from '@ojiepermana/angular/navigation';
import type { AuthPermission, AuthRole } from '../auth/auth.service';

export const APP_BRAND_ICON = 'payments' as const;

/** Application navigation grouped by the main areas of the payroll app. */
export function appNavigationFor(
  permissions: readonly AuthPermission[],
  role?: AuthRole,
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

  const settingsItems: NavigationItem[] = [];
  if (permissions.includes('users.manage')) {
    settingsItems.push({
      id: 'users',
      type: 'item',
      title: 'User Access',
      icon: 'admin_panel_settings',
      link: '/setting/users',
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

  const group = (title: string, children: readonly NavigationItem[]): NavigationItem => ({
    type: 'group',
    title,
    children,
  });

  return [
    group('Overview', overviewItems),
    ...(settingsItems.length > 0 ? [group('Settings', settingsItems)] : []),
    ...(logItems.length > 0 ? [group('Logs', logItems)] : []),
  ];
}
