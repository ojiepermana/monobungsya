import { HttpClient } from '@angular/common/http';
import { inject, Service, signal } from '@angular/core';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { TauriService } from '../desktop/tauri.service';
import { AuthService, type AuthUser } from './auth.service';

export interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  backupState: boolean;
}

export interface PasskeyLoginResponse {
  authenticated: boolean;
  mfaRequired?: boolean;
  purpose?: 'login' | 'enroll';
  user?: AuthUser;
}

/** Thrown when the person closes or cancels the browser's passkey dialog. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('Passkey dibatalkan.');
  }
}

/** Mirrors the server side cap in the auth service. */
export const MAX_PASSKEYS = 5;

const PROMPT_DISMISSED_KEY = 'monobungsya.passkey-prompt-dismissed';

@Service()
export class PasskeyService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;
  private readonly tauri = inject(TauriService);
  private readonly auth = inject(AuthService);

  readonly passkeys = signal<Passkey[]>([]);
  readonly loaded = signal(false);

  /**
   * Passkeys are offered only in a browser that implements WebAuthn and never in
   * the Tauri desktop window, whose webview cannot run the ceremony reliably.
   * Everything the server does is validated regardless: this gate is
   * convenience, not security.
   */
  supported(): boolean {
    return !this.tauri.isAvailable() && browserSupportsWebAuthn();
  }

  /** Registers a passkey for the signed in user. Returns the stored passkey. */
  async register(label?: string): Promise<Passkey> {
    const options = await this.post<PublicKeyCredentialCreationOptionsJSON>(
      '/api/v1/auth/passkey/register/options',
    );
    const attestation = await this.runCeremony(() =>
      startRegistration({ optionsJSON: options }),
    );
    const created = await this.post<Passkey>(
      '/api/v1/auth/passkey/register/verify',
      {
        response: attestation,
        ...(label && label.trim().length > 0 ? { label: label.trim() } : {}),
      },
    );

    this.passkeys.update((current) => [...current, created]);

    return created;
  }

  /**
   * Signs in with a discoverable passkey. No email is typed: the browser offers
   * whichever passkey is registered for this site.
   */
  async signIn(): Promise<AuthUser | null> {
    const options = await this.post<PublicKeyCredentialRequestOptionsJSON>(
      '/api/v1/auth/passkey/login/options',
    );
    const assertion = await this.runCeremony(() =>
      startAuthentication({ optionsJSON: options }),
    );
    const result = await this.post<PasskeyLoginResponse>(
      '/api/v1/auth/passkey/login/verify',
      { response: assertion },
    );

    if (result.mfaRequired) {
      return null;
    }

    // The session cookie is already set, so the shared user state is refreshed
    // from the session endpoint the same way every other login path does it.
    const user = await firstValueFrom(this.auth.loadCurrentUser());

    return user ?? result.user ?? null;
  }

  async load(): Promise<Passkey[]> {
    const response = await firstValueFrom(
      this.http.get<{ passkeys: Passkey[] }>(
        `${this.base}/api/v1/auth/passkeys`,
      ),
    );
    this.passkeys.set(response.passkeys);
    this.loaded.set(true);

    return response.passkeys;
  }

  async rename(id: string, label: string): Promise<Passkey> {
    const updated = await firstValueFrom(
      this.http.patch<Passkey>(`${this.base}/api/v1/auth/passkeys/${id}`, {
        label,
      }),
    );
    this.passkeys.update((current) =>
      current.map((passkey) => (passkey.id === updated.id ? updated : passkey)),
    );

    return updated;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${this.base}/api/v1/auth/passkeys/${id}`),
    );
    this.passkeys.update((current) =>
      current.filter((passkey) => passkey.id !== id),
    );
  }

  /** The one time prompt after a magic link login, dismissed per browser. */
  promptDismissed(): boolean {
    try {
      return window.localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
    } catch {
      // Private mode or blocked storage: treat it as dismissed rather than
      // showing the prompt on every visit.
      return true;
    }
  }

  dismissPrompt(): void {
    try {
      window.localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Nothing to persist to; the prompt simply reappears next visit.
    }
  }

  /** Reads a message out of either an error envelope or a plain text body. */
  messageFrom(error: unknown, fallback: string): string {
    if (error instanceof PasskeyCancelled) {
      return error.message;
    }

    const body = (error as { error?: unknown })?.error;

    if (typeof body === 'string' && body.length > 0) {
      return body;
    }

    const envelope = (body as { error?: { message?: string } })?.error?.message;

    if (typeof envelope === 'string' && envelope.length > 0) {
      return envelope;
    }

    const text = (body as { text?: string })?.text;

    if (typeof text === 'string' && text.length > 0) {
      return text;
    }

    return fallback;
  }

  private async post<TResponse>(
    path: string,
    body?: unknown,
  ): Promise<TResponse> {
    return firstValueFrom(
      this.http.post<TResponse>(`${this.base}${path}`, body ?? {}),
    );
  }

  private async runCeremony<
    TResponse extends RegistrationResponseJSON | AuthenticationResponseJSON,
  >(run: () => Promise<TResponse>): Promise<TResponse> {
    try {
      return await run();
    } catch (error) {
      if (isCancellation(error)) {
        throw new PasskeyCancelled();
      }

      throw error;
    }
  }
}

function isCancellation(error: unknown): boolean {
  const name = (error as { name?: string })?.name;

  return name === 'NotAllowedError' || name === 'AbortError';
}
