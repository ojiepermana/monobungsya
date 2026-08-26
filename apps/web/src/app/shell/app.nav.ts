import type { NavigationItem } from '@ojiepermana/angular/navigation';
import type { AuthPermission } from '../auth/auth.service';
import {
  hasAnyRequiredPermission,
  hasResolvedPermission,
  PERMISSIONS,
} from '../auth/permissions';

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

  const observabilityItems: NavigationItem[] = [];
  if (
    hasAnyRequiredPermission(permissions, [
      PERMISSIONS.observabilityTraceRead,
      PERMISSIONS.observabilityMetricRead,
      PERMISSIONS.observabilityBenchmarkRead,
      PERMISSIONS.observabilityAlertRead,
    ])
  ) {
    observabilityItems.push({
      id: 'observability-overview',
      type: 'item',
      title: 'Overview',
      icon: 'monitor_heart',
      link: '/observability',
    });
  }
  if (hasResolvedPermission(permissions, PERMISSIONS.observabilityTraceRead)) {
    observabilityItems.push({
      id: 'observability-traces',
      type: 'item',
      title: 'Traces',
      icon: 'account_tree',
      link: '/observability/traces',
    });
  }
  if (hasResolvedPermission(permissions, PERMISSIONS.observabilityMetricRead)) {
    observabilityItems.push({
      id: 'observability-metrics',
      type: 'item',
      title: 'Metrics',
      icon: 'insights',
      link: '/observability/metrics',
    });
  }
  if (
    hasResolvedPermission(permissions, PERMISSIONS.observabilityBenchmarkRead)
  ) {
    observabilityItems.push(
      {
        id: 'observability-benchmarks',
        type: 'item',
        title: 'Benchmarks',
        icon: 'speed',
        link: '/observability/benchmarks',
      },
      {
        id: 'observability-baselines',
        type: 'item',
        title: 'Baselines',
        icon: 'verified',
        link: '/observability/baselines',
      },
    );
  }
  if (hasResolvedPermission(permissions, PERMISSIONS.observabilityAlertRead)) {
    observabilityItems.push({
      id: 'observability-alerts',
      type: 'item',
      title: 'Alerts',
      icon: 'notification_important',
      link: '/observability/alerts',
    });
  }

  const accessItems: NavigationItem[] = [];
  if (hasResolvedPermission(permissions, PERMISSIONS.accessPermissionList)) {
    accessItems.push({
      id: 'permissions',
      type: 'item',
      title: 'Catalog',
      icon: 'list_alt',
      link: '/permission/catalog',
    });
  }
  if (hasResolvedPermission(permissions, PERMISSIONS.accessGroupList)) {
    accessItems.push({
      id: 'groups',
      type: 'item',
      title: 'Group',
      icon: 'group',
      link: '/permission/group',
    });
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
    ...(observabilityItems.length > 0
      ? [group('Observability', observabilityItems)]
      : []),
  ];
}
