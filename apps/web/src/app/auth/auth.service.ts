import { Service, signal } from '@angular/core';
import { defer, map, Observable, tap } from 'rxjs';
import {
  type GetApiV1AuthSessionResponse,
  getApiV1AuthSession,
  postApiV1AuthLogout,
  postApiV1AuthMagicLink,
} from '#project/angular-sdk';
import { sdkRequest } from '../../api/generated-client';
import { environment } from '../../environments/environment';
import type { PermissionName } from './permissions';
import { hasResolvedPermission } from './permissions';

export type AuthPermission = PermissionName;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  permissions: AuthPermission[];
}

export interface RequestMagicLinkResponse {
  accepted: true;
  message?: string;
  magicLink?: string;
  expiresAt?: string;
}

export interface RequestMagicLinkOptions {
  desktop?: boolean;
}

export interface VerifyMagicLinkResponse {
  status: 'sent' | 'success' | 'expired' | 'invalid' | 'missing';
  message: string;
  user?: AuthUser;
}

export interface MeResponse {
  authenticated: boolean;
  user?: AuthUser;
}

@Service()
export class AuthService {
  readonly user = signal<AuthUser | null>(null);
  readonly loaded = signal(false);

  requestMagicLink(
    email: string,
    options: RequestMagicLinkOptions = {},
  ): Observable<RequestMagicLinkResponse> {
    return defer(() =>
      sdkRequest<RequestMagicLinkResponse>(() =>
        postApiV1AuthMagicLink({
          body: { email, ...(options.desktop ? { desktop: true } : {}) },
          throwOnError: true,
        }),
      ),
    );
  }

  verifyMagicLink(token: string | null): Observable<VerifyMagicLinkResponse> {
    if (!token) {
      return this.loadCurrentUser().pipe(
        map((user) =>
          user
            ? {
                status: 'success' as const,
                message: 'Login berhasil.',
                user,
              }
            : {
                status: 'missing' as const,
                message: 'Sesi login tidak ditemukan.',
              },
        ),
      );
    }

    window.location.assign(
      `${environment.apiUrl}/api/v1/auth/verify?token=${encodeURIComponent(token)}`,
    );

    return new Observable<VerifyMagicLinkResponse>();
  }

  loadCurrentUser(): Observable<AuthUser | null> {
    return defer(() =>
      sdkRequest<GetApiV1AuthSessionResponse>(() =>
        getApiV1AuthSession({ throwOnError: true }),
      ),
    ).pipe(
      map((response) =>
        response.authenticated && response.user
          ? {
              ...response.user,
              permissions: response.user.permissions as AuthPermission[],
            }
          : null,
      ),
      tap((user) => {
        this.user.set(user);
        this.loaded.set(true);
      }),
    );
  }

  logout(): Observable<void> {
    return defer(() =>
      sdkRequest<void>(() => postApiV1AuthLogout({ throwOnError: true })),
    ).pipe(
      tap(() => {
        this.user.set(null);
        this.loaded.set(true);
      }),
      map(() => undefined),
    );
  }

  hasPermission(permission: AuthPermission): boolean {
    return hasResolvedPermission(this.user()?.permissions, permission);
  }
}
