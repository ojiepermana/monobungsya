import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TauriService } from '../desktop/tauri.service';
import { PasskeyService } from './passkey.service';

function serviceWith(tauriAvailable: boolean): PasskeyService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: TauriService,
        useValue: {
          isAvailable: () => tauriAvailable,
        } as Partial<TauriService>,
      },
    ],
  });

  return TestBed.inject(PasskeyService);
}

describe('PasskeyService gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('offers passkeys in a browser that implements WebAuthn', () => {
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});

    expect(serviceWith(false).supported()).toBe(true);
  });

  it('never offers passkeys inside the Tauri desktop shell', () => {
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});

    expect(serviceWith(true).supported()).toBe(false);
  });

  it('never offers passkeys in a browser without WebAuthn', () => {
    vi.stubGlobal('PublicKeyCredential', undefined);

    expect(serviceWith(false).supported()).toBe(false);
  });
});

describe('PasskeyService prompt dismissal', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('remembers a dismissal for this browser', () => {
    const service = serviceWith(false);

    expect(service.promptDismissed()).toBe(false);

    service.dismissPrompt();

    expect(service.promptDismissed()).toBe(true);
    // A fresh instance reads the same stored answer.
    expect(serviceWith(false).promptDismissed()).toBe(true);
  });
});

describe('PasskeyService error messages', () => {
  it('reads a plain text error body', () => {
    const service = serviceWith(false);

    expect(
      service.messageFrom({ error: 'Passkey sign in failed' }, 'fallback'),
    ).toBe('Passkey sign in failed');
  });

  it('reads a json error envelope', () => {
    const service = serviceWith(false);

    expect(
      service.messageFrom(
        { error: { error: { code: 'GONE', message: 'Challenge expired' } } },
        'fallback',
      ),
    ).toBe('Challenge expired');
  });

  it('falls back when the body carries nothing usable', () => {
    const service = serviceWith(false);

    expect(service.messageFrom({ error: null }, 'fallback')).toBe('fallback');
    expect(service.messageFrom(undefined, 'fallback')).toBe('fallback');
  });
});
