import { Service } from '@angular/core';
import { defer, type Observable } from 'rxjs';
import {
  getApiV1Auth2FaStatus,
  getApiV1AuthAdminUsersById2Fa,
  postApiV1Auth2FaDisable,
  postApiV1Auth2FaEnroll,
  postApiV1Auth2FaEnrollConfirm,
  postApiV1Auth2FaRecoveryCodes,
  postApiV1Auth2FaVerify,
  postApiV1AuthAdminUsersById2FaReset,
  putApiV1UsersById2FaRequirement,
} from '#project/angular-sdk';
import { sdkRequest } from '../../api/generated-client';

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
  status(): Observable<TotpStatus> {
    return defer(() =>
      sdkRequest<TotpStatus>(() =>
        getApiV1Auth2FaStatus({ throwOnError: true }),
      ),
    );
  }

  enroll(): Observable<TotpEnrollment> {
    return defer(() =>
      sdkRequest<TotpEnrollment>(() =>
        postApiV1Auth2FaEnroll({ throwOnError: true }),
      ),
    );
  }

  confirm(code: string): Observable<TotpRecoveryCodes> {
    return defer(() =>
      sdkRequest<TotpRecoveryCodes>(() =>
        postApiV1Auth2FaEnrollConfirm({ body: { code }, throwOnError: true }),
      ),
    );
  }

  verify(
    code?: string,
    recoveryCode?: string,
  ): Observable<{ authenticated: true; redirectTo: string }> {
    return defer(() =>
      sdkRequest<{ authenticated: true; redirectTo: string }>(() =>
        postApiV1Auth2FaVerify({
          body: {
            ...(code ? { code } : {}),
            ...(recoveryCode ? { recoveryCode } : {}),
          },
          throwOnError: true,
        }),
      ),
    );
  }

  disable(code?: string, recoveryCode?: string): Observable<{ ok: true }> {
    return defer(() =>
      sdkRequest<{ ok: true }>(() =>
        postApiV1Auth2FaDisable({
          body: {
            ...(code ? { code } : {}),
            ...(recoveryCode ? { recoveryCode } : {}),
          },
          throwOnError: true,
        }),
      ),
    );
  }

  regenerateRecoveryCodes(code: string): Observable<TotpRecoveryCodes> {
    return defer(() =>
      sdkRequest<TotpRecoveryCodes>(() =>
        postApiV1Auth2FaRecoveryCodes({ body: { code }, throwOnError: true }),
      ),
    );
  }

  adminStatus(userId: string): Observable<TotpStatus> {
    return defer(() =>
      sdkRequest<TotpStatus>(() =>
        getApiV1AuthAdminUsersById2Fa({
          path: { id: userId },
          throwOnError: true,
        }),
      ),
    );
  }

  adminReset(userId: string, reason: string): Observable<{ ok: true }> {
    return defer(() =>
      sdkRequest<{ ok: true }>(() =>
        postApiV1AuthAdminUsersById2FaReset({
          path: { id: userId },
          body: { reason },
          throwOnError: true,
        }),
      ),
    );
  }

  setRequirement(
    userId: string,
    required: boolean,
    reason: string,
  ): Observable<{ ok: true }> {
    return defer(() =>
      sdkRequest<{ ok: true }>(() =>
        putApiV1UsersById2FaRequirement({
          path: { id: userId },
          body: { required, reason },
          throwOnError: true,
        }),
      ),
    );
  }
}
