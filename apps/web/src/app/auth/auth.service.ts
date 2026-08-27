import { Service, signal } from '@angular/core';
import {
  catchError,
  defer,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';
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
  status: 'gagal' | 'belum_verifikasi' | 'berhasil';
  keterangan: string;
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

export type SessionState =
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'service-error';

@Service()
export class AuthService {
  readonly user = signal<AuthUser | null>(null);
  readonly loaded = signal(false);
  readonly sessionState = signal<SessionState>('checking');
  private sessionRequest: Observable<AuthUser | null> | null = null;

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

    const apiUrl =
      environment.apiUrl ||
      (window.location.protocol === 'tauri:' ? 'http://localhost:3000' : '');

    window.location.replace(
      `${apiUrl}/api/v1/auth/verify?token=${encodeURIComponent(token)}`,
    );

    return new Observable<VerifyMagicLinkResponse>();
  }

  loadCurrentUser(): Observable<AuthUser | null> {
    if (this.loaded()) {
      return of(this.user());
    }

    if (this.sessionRequest) {
      return this.sessionRequest;
    }

    this.sessionState.set('checking');
    this.sessionRequest = defer(() =>
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
        this.sessionState.set(user ? 'authenticated' : 'unauthenticated');
      }),
      catchError((error: unknown) => {
        this.sessionState.set('service-error');
        return throwError(() => error);
      }),
      finalize(() => {
        this.sessionRequest = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.sessionRequest;
  }

  retrySession(): Observable<AuthUser | null> {
    this.loaded.set(false);
    this.user.set(null);
    return this.loadCurrentUser();
  }

  logout(): Observable<void> {
    return defer(() =>
      sdkRequest<void>(() => postApiV1AuthLogout({ throwOnError: true })),
    ).pipe(
      tap(() => {
        this.user.set(null);
        this.loaded.set(true);
        this.sessionState.set('unauthenticated');
      }),
      map(() => undefined),
    );
  }

  hasPermission(permission: AuthPermission): boolean {
    return hasResolvedPermission(this.user()?.permissions, permission);
  }
}
