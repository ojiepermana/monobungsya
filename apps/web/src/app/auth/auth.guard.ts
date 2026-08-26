import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import type { AuthPermission, AuthUser } from './auth.service';
import { AuthService } from './auth.service';
import { hasAnyRequiredPermission, hasResolvedPermission } from './permissions';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.loaded()) {
    return auth.user() ? true : router.parseUrl('/login');
  }

  return auth.loadCurrentUser().pipe(
    map((user) => (user ? true : router.parseUrl('/login'))),
    catchError(() => of(false)),
  );
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.loaded()) {
    return auth.user() ? router.parseUrl('/') : true;
  }

  return auth.loadCurrentUser().pipe(
    map((user) => (user ? router.parseUrl('/') : true)),
    catchError(() => of(true)),
  );
};

export function permissionGuard(permission: AuthPermission): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const decide = (user: AuthUser | null) =>
      hasResolvedPermission(user?.permissions, permission)
        ? true
        : router.parseUrl('/');

    if (auth.loaded()) {
      return decide(auth.user());
    }

    return auth.loadCurrentUser().pipe(
      map(decide),
      catchError(() => of(false)),
    );
  };
}

export function anyPermissionGuard(
  permissions: readonly AuthPermission[],
): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const decide = (user: AuthUser | null) =>
      hasAnyRequiredPermission(user?.permissions, permissions)
        ? true
        : router.parseUrl('/');

    if (auth.loaded()) {
      return decide(auth.user());
    }

    return auth.loadCurrentUser().pipe(
      map(decide),
      catchError(() => of(false)),
    );
  };
}
