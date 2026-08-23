import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TotpStatus {
  enabled: boolean;
  confirmedAt: string | null;
  required: boolean;
  recoveryCodesRemaining: number;
}

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

export interface TotpRecoveryCodes {
  recoveryCodes: string[];
}

@Service()
export class TotpService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  status(): Observable<TotpStatus> {
    return this.http.get<TotpStatus>(`${this.base}/api/v1/auth/2fa/status`);
  }

  enroll(): Observable<TotpEnrollment> {
    return this.http.post<TotpEnrollment>(
      `${this.base}/api/v1/auth/2fa/enroll`,
      {},
    );
  }

  confirm(code: string): Observable<TotpRecoveryCodes> {
    return this.http.post<TotpRecoveryCodes>(
      `${this.base}/api/v1/auth/2fa/enroll/confirm`,
      { code },
    );
  }

  verify(
    code?: string,
    recoveryCode?: string,
  ): Observable<{ authenticated: true; redirectTo: string }> {
    return this.http.post<{ authenticated: true; redirectTo: string }>(
      `${this.base}/api/v1/auth/2fa/verify`,
      { ...(code ? { code } : {}), ...(recoveryCode ? { recoveryCode } : {}) },
    );
  }

  disable(code?: string, recoveryCode?: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(
      `${this.base}/api/v1/auth/2fa/disable`,
      { ...(code ? { code } : {}), ...(recoveryCode ? { recoveryCode } : {}) },
    );
  }

  regenerateRecoveryCodes(code: string): Observable<TotpRecoveryCodes> {
    return this.http.post<TotpRecoveryCodes>(
      `${this.base}/api/v1/auth/2fa/recovery-codes`,
      { code },
    );
  }

  adminStatus(userId: string): Observable<TotpStatus> {
    return this.http.get<TotpStatus>(
      `${this.base}/api/v1/auth/admin/users/${encodeURIComponent(userId)}/2fa`,
    );
  }

  adminReset(userId: string, reason: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(
      `${this.base}/api/v1/auth/admin/users/${encodeURIComponent(userId)}/2fa/reset`,
      { reason },
    );
  }

  setRequirement(
    userId: string,
    required: boolean,
    reason: string,
  ): Observable<{ ok: true }> {
    return this.http.put<{ ok: true }>(
      `${this.base}/api/v1/users/${encodeURIComponent(userId)}/2fa-requirement`,
      { required, reason },
    );
  }
}
