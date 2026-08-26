import type { Routes } from '@angular/router';
import {
  anyPermissionGuard,
  authGuard,
  guestGuard,
  permissionGuard,
} from '../auth/auth.guard';
import { PERMISSIONS } from '../auth/permissions';

export const routes: Routes = [
  {
    path: 'auth/login',
    title: 'MONOBUNGSYA · Login',
    canActivate: [guestGuard],
    loadComponent: () => import('../auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'auth/callback-complete',
    title: 'MONOBUNGSYA · Login Complete',
    data: { callback: 'success' },
    loadComponent: () =>
      import('../auth/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: 'auth/callback-error',
    title: 'MONOBUNGSYA · Login Error',
    data: { callback: 'error' },
    loadComponent: () =>
      import('../auth/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: 'auth/two-factor',
    title: 'MONOBUNGSYA · Two Factor',
    loadComponent: () =>
      import('../auth/two-factor.page').then((m) => m.TwoFactorPage),
  },
  {
    path: 'auth/two-factor/enroll',
    title: 'MONOBUNGSYA · Two Factor Enrollment',
    data: { purpose: 'enroll' },
    loadComponent: () =>
      import('../auth/two-factor.page').then((m) => m.TwoFactorPage),
  },
  {
    path: 'login',
    redirectTo: 'auth/login',
    pathMatch: 'full',
  },
  {
    path: 'verify',
    title: 'MONOBUNGSYA · Verify',
    loadComponent: () =>
      import('../auth/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: '',
    title: 'MONOBUNGSYA · Dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/logs/overview/dashboard.page').then(
        (m) => m.DashboardPage,
      ),
  },
  {
    path: 'setting/passkeys',
    title: 'MONOBUNGSYA · Passkey',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/settings/passkeys/passkeys.page').then(
        (m) => m.PasskeysSettingsPage,
      ),
  },
  {
    path: 'users',
    title: 'MONOBUNGSYA · User Management',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.userUserList)],
    loadComponent: () =>
      import('../pages/users/list/users.page').then((m) => m.UsersPage),
  },
  {
    path: 'users/:id',
    title: 'MONOBUNGSYA · User Detail',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.userUserRead)],
    loadComponent: () =>
      import('../pages/users/detail/user-detail.page').then(
        (m) => m.UserDetailPage,
      ),
  },
  {
    path: 'permission/catalog',
    title: 'MONOBUNGSYA · Permissions',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.accessPermissionList)],
    loadComponent: () =>
      import('../pages/access/permissions/permissions.page').then(
        (m) => m.PermissionsPage,
      ),
  },
  {
    path: 'access/catalog',
    redirectTo: 'permission/catalog',
    pathMatch: 'full',
  },
  {
    path: 'permission/group',
    title: 'MONOBUNGSYA · Permission Groups',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.accessGroupList)],
    loadComponent: () =>
      import('../pages/access/groups/groups.page').then((m) => m.GroupsPage),
  },
  {
    path: 'permission/group/:id',
    title: 'MONOBUNGSYA · Permission Group',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.accessGroupRead)],
    loadComponent: () =>
      import('../pages/access/groups/group-detail.page').then(
        (m) => m.GroupDetailPage,
      ),
  },
  {
    path: 'notifications',
    title: 'MONOBUNGSYA · Notifikasi',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/notifications/notifications.page').then(
        (m) => m.NotificationsPage,
      ),
  },
  {
    path: 'operations/jobs',
    title: 'MONOBUNGSYA · Durable Jobs',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.jobsJobList)],
    loadComponent: () =>
      import('../pages/operations/jobs/jobs.page').then((m) => m.JobsPage),
  },
  {
    path: 'operations/jobs/:id',
    title: 'MONOBUNGSYA · Job Detail',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.jobsJobRead)],
    loadComponent: () =>
      import('../pages/operations/jobs/job-detail.page').then(
        (m) => m.JobDetailPage,
      ),
  },
  {
    path: 'access/permissions',
    redirectTo: 'permission/catalog',
    pathMatch: 'full',
  },
  {
    path: 'access/permission',
    redirectTo: 'permission/catalog',
    pathMatch: 'full',
  },
  {
    path: 'access/group',
    redirectTo: 'permission/group',
    pathMatch: 'full',
  },
  {
    // The old settings path kept as a redirect, so a bookmark still lands.
    path: 'setting/users',
    redirectTo: 'users',
    pathMatch: 'full',
  },
  {
    path: 'logs',
    redirectTo: 'logs/audit',
    pathMatch: 'full',
  },
  {
    path: 'observability',
    title: 'MONOBUNGSYA · Observability',
    pathMatch: 'full',
    canActivate: [
      authGuard,
      anyPermissionGuard([
        PERMISSIONS.observabilityTraceRead,
        PERMISSIONS.observabilityMetricRead,
        PERMISSIONS.observabilityBenchmarkRead,
        PERMISSIONS.observabilityAlertRead,
      ]),
    ],
    loadComponent: () =>
      import('../pages/observability/overview/overview.page').then(
        (m) => m.ObservabilityOverviewPage,
      ),
  },
  {
    path: 'observability/traces',
    title: 'MONOBUNGSYA · Traces',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityTraceRead),
    ],
    loadComponent: () =>
      import('../pages/observability/traces/traces.page').then(
        (m) => m.ObservabilityTracesPage,
      ),
  },
  {
    path: 'observability/traces/:traceId',
    title: 'MONOBUNGSYA · Trace detail',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityTraceRead),
    ],
    loadComponent: () =>
      import('../pages/observability/traces/trace-detail.page').then(
        (m) => m.ObservabilityTraceDetailPage,
      ),
  },
  {
    path: 'observability/metrics',
    title: 'MONOBUNGSYA · Metrics',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityMetricRead),
    ],
    loadComponent: () =>
      import('../pages/observability/metrics/metrics.page').then(
        (m) => m.ObservabilityMetricsPage,
      ),
  },
  {
    path: 'observability/benchmarks',
    title: 'MONOBUNGSYA · Benchmarks',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityBenchmarkRead),
    ],
    loadComponent: () =>
      import('../pages/observability/benchmarks/benchmarks.page').then(
        (m) => m.ObservabilityBenchmarksPage,
      ),
  },
  {
    path: 'observability/benchmarks/:runId',
    title: 'MONOBUNGSYA · Benchmark detail',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityBenchmarkRead),
    ],
    loadComponent: () =>
      import('../pages/observability/benchmarks/benchmark-detail.page').then(
        (m) => m.ObservabilityBenchmarkDetailPage,
      ),
  },
  {
    path: 'observability/baselines',
    title: 'MONOBUNGSYA · Baselines',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityBenchmarkRead),
    ],
    loadComponent: () =>
      import('../pages/observability/baselines/baselines.page').then(
        (m) => m.ObservabilityBaselinesPage,
      ),
  },
  {
    path: 'observability/alerts',
    title: 'MONOBUNGSYA · Alerts',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityAlertRead),
    ],
    loadComponent: () =>
      import('../pages/observability/alerts/alerts.page').then(
        (m) => m.ObservabilityAlertsPage,
      ),
  },
  {
    path: 'observability/alerts/:ruleId',
    title: 'MONOBUNGSYA · Alert detail',
    canActivate: [
      authGuard,
      permissionGuard(PERMISSIONS.observabilityAlertRead),
    ],
    loadComponent: () =>
      import('../pages/observability/alerts/alert-detail.page').then(
        (m) => m.ObservabilityAlertDetailPage,
      ),
  },
  {
    path: 'logs/audit',
    title: 'MONOBUNGSYA · Audit Logs',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.logsLogRead)],
    loadComponent: () =>
      import('../pages/logs/audit/audit-logs.page').then(
        (m) => m.AuditLogsPage,
      ),
  },
  {
    path: 'logs/access',
    title: 'MONOBUNGSYA · Access Logs',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.logsLogRead)],
    loadComponent: () =>
      import('../pages/logs/access/access-logs.page').then(
        (m) => m.AccessLogsPage,
      ),
  },
  {
    path: 'logs/application',
    title: 'MONOBUNGSYA · Application Logs',
    canActivate: [authGuard, permissionGuard(PERMISSIONS.logsLogRead)],
    loadComponent: () =>
      import('../pages/logs/application/application-logs.page').then(
        (m) => m.ApplicationLogsPage,
      ),
  },
  {
    path: '**',
    title: 'MONOBUNGSYA · Page Not Found',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/system/not-found/not-found.page').then(
        (m) => m.NotFoundPage,
      ),
  },
];
