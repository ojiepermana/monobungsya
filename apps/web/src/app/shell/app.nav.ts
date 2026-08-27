import type { NavigationItem } from '@ojiepermana/angular/navigation';
import type { AuthPermission } from '../auth/auth.service';
import { hasResolvedPermission, PERMISSIONS } from '../auth/permissions';

export const APP_BRAND_ICON = 'apps' as const;

/** Application navigation grouped by the main areas of the app. */
export function appNavigationFor(
  permissions: readonly AuthPermission[],
): readonly NavigationItem[] {
  const overviewItems: NavigationItem[] = [
    {
      id: 'logs-overview',
      type: 'item',
      title: 'Dashboard',
      icon: 'dashboard',
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

  const notificationItems: NavigationItem[] = [
    {
      id: 'notifications',
      type: 'item',
      title: 'Notifikasi',
      icon: 'notifications',
      link: '/notifications',
    },
  ];
  const operationItems: NavigationItem[] = [];
  if (hasResolvedPermission(permissions, PERMISSIONS.jobsJobList)) {
    operationItems.push({
      id: 'jobs',
      type: 'item',
      title: 'Durable Jobs',
      icon: 'sync',
      link: '/operations/jobs',
    });
  }

  const userItems: NavigationItem[] = [];
  if (hasResolvedPermission(permissions, PERMISSIONS.userUserList)) {
    userItems.push({
      id: 'users',
      type: 'item',
      title: 'User Management',
      icon: 'admin_panel_settings',
      link: '/users',
    });
  }

  const logItems: NavigationItem[] = [];
  if (hasResolvedPermission(permissions, PERMISSIONS.logsLogRead)) {
    logItems.push({
      id: 'logs-audit',
      type: 'item',
      title: 'Audit Logs',
      icon: 'history',
      link: '/logs/audit',
    });
  }

  const accessItems: NavigationItem[] = [];
  if (hasResolvedPermission(permissions, PERMISSIONS.accessPermissionList)) {
    accessItems.push(
      {
        id: 'permissions',
        type: 'item',
        title: 'Catalog',
        icon: 'list_alt',
        link: '/permission/catalog',
      },
      {
        id: 'groups',
        type: 'item',
        title: 'Group',
        icon: 'group',
        link: '/permission/group',
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
    group('Workspace', notificationItems),
    ...(operationItems.length > 0 ? [group('Operations', operationItems)] : []),
    ...(userItems.length > 0 ? [group('Users', userItems)] : []),
    ...(settingsItems.length > 0 ? [group('Settings', settingsItems)] : []),
    ...(accessItems.length > 0 ? [group('Permission', accessItems)] : []),
    ...(logItems.length > 0 ? [group('Logs', logItems)] : []),
  ];
}
