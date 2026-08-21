import { inject, signal, Service } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export type AuthRole = 'admin' | 'manager' | 'bi' | 'staff' | 'legacy';

export type AuthPermission =
  | 'users.manage'
  | 'logs.read';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
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
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  readonly user = signal<AuthUser | null>(null);
  readonly loaded = signal(false);

  requestMagicLink(
    email: string,
    options: RequestMagicLinkOptions = {},
  ): Observable<RequestMagicLinkResponse> {
    return this.http.post<RequestMagicLinkResponse>(`${this.base}/api/v1/auth/magic-link`, {
      email,
      ...(options.desktop ? { desktop: true } : {}),
    });
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
      `${this.base}/api/v1/auth/verify?token=${encodeURIComponent(token)}`,
    );

    return new Observable<VerifyMagicLinkResponse>();
  }

  loadCurrentUser(): Observable<AuthUser | null> {
    return this.http.get<MeResponse>(`${this.base}/api/v1/auth/session`).pipe(
      map((response) => (response.authenticated ? (response.user ?? null) : null)),
      tap((user) => {
        this.user.set(user);
        this.loaded.set(true);
      }),
    );
  }

  logout(): Observable<void> {
    return this.http.post<{ success: boolean }>(`${this.base}/api/v1/auth/logout`, {}).pipe(
      tap(() => {
        this.user.set(null);
        this.loaded.set(true);
      }),
      map(() => undefined),
    );
  }

  hasPermission(permission: AuthPermission): boolean {
    return this.user()?.permissions.includes(permission) ?? false;
  }
}
