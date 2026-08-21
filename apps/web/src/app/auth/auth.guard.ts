import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';
import type { AuthPermission, AuthUser } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.loadCurrentUser().pipe(
    map((user) => (user ? true : router.parseUrl('/login'))),
    catchError(() => of(router.parseUrl('/login'))),
  );
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

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
      user?.permissions.includes(permission) ? true : router.parseUrl('/');

    if (auth.loaded()) {
      return decide(auth.user());
    }

    return auth.loadCurrentUser().pipe(
      map(decide),
      catchError(() => of(router.parseUrl('/login'))),
    );
  };
}
