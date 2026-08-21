import type { Routes } from '@angular/router';
import { authGuard, guestGuard, permissionGuard } from '../auth/auth.guard';

export const routes: Routes = [
  {
    path: 'auth/login',
    title: 'ETOS · Login',
    canActivate: [guestGuard],
    loadComponent: () => import('../auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'auth/callback-complete',
    title: 'ETOS · Login Complete',
    data: { callback: 'success' },
    loadComponent: () => import('../auth/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: 'auth/callback-error',
    title: 'ETOS · Login Error',
    data: { callback: 'error' },
    loadComponent: () => import('../auth/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: 'login',
    redirectTo: 'auth/login',
    pathMatch: 'full',
  },
  {
    path: 'verify',
    title: 'ETOS · Verify',
    loadComponent: () => import('../auth/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: '',
    title: 'ETOS · Logs',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/logs/overview/logs.page').then(
        (m) => m.LogsPage,
      ),
  },
  {
    path: 'setting/users',
    title: 'ETOS · User Access',
    canActivate: [authGuard, permissionGuard('users.manage')],
    loadComponent: () =>
      import('../pages/settings/user-access-settings/user-access-settings.page').then(
        (m) => m.UserAccessSettingsPage,
      ),
  },
  {
    path: 'logs',
    redirectTo: 'logs/audit',
    pathMatch: 'full',
  },
  {
    path: 'logs/audit',
    title: 'ETOS · Audit Logs',
    canActivate: [authGuard, permissionGuard('logs.read')],
    loadComponent: () =>
      import('../pages/logs/audit/audit-logs.page').then((m) => m.AuditLogsPage),
  },
  {
    path: 'logs/access',
    title: 'ETOS · Access Logs',
    canActivate: [authGuard, permissionGuard('logs.read')],
    loadComponent: () =>
      import('../pages/logs/access/access-logs.page').then((m) => m.AccessLogsPage),
  },
  {
    path: 'logs/application',
    title: 'ETOS · Application Logs',
    canActivate: [authGuard, permissionGuard('logs.read')],
    loadComponent: () =>
      import('../pages/logs/application/application-logs.page').then(
        (m) => m.ApplicationLogsPage,
      ),
  },
  {
    path: '**',
    title: 'ETOS · Page Not Found',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/system/not-found/not-found.page').then((m) => m.NotFoundPage),
  },
];
