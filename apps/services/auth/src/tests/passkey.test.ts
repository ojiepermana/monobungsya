import { describe, expect, it } from 'bun:test';
import { loadAuthEnv } from '../config/env';
import {
  authenticatorName,
  defaultPasskeyLabel,
  normalizeAaguid,
} from '../modules/auth/passkey.authenticators';

describe('passkey relying party configuration', () => {
  it('defaults the relying party id to the web app host', () => {
    const environment = loadAuthEnv({
      NODE_ENV: 'test',
      PORT: '3101',
      WEB_APP_URL: 'https://erp.monobungsya.id',
    });

    expect(environment.WEBAUTHN_RP_ID).toBe('erp.monobungsya.id');
    expect(environment.WEBAUTHN_RP_NAME).toBe('Monobungsya');
  });

  it('treats a blank override as unset so the default still applies', () => {
    const environment = loadAuthEnv({
      NODE_ENV: 'test',
      PORT: '3101',
      WEB_APP_URL: 'https://erp.monobungsya.id',
      WEBAUTHN_RP_ID: '',
      WEBAUTHN_RP_NAME: '   ',
    });

    expect(environment.WEBAUTHN_RP_ID).toBe('erp.monobungsya.id');
    expect(environment.WEBAUTHN_RP_NAME).toBe('Monobungsya');
  });

  it('uses an explicit override when one is given', () => {
    const environment = loadAuthEnv({
      NODE_ENV: 'test',
      PORT: '3101',
      WEB_APP_URL: 'https://erp.monobungsya.id',
      WEBAUTHN_RP_ID: 'monobungsya.id',
      WEBAUTHN_RP_NAME: 'Monobungsya ERP',
    });

    expect(environment.WEBAUTHN_RP_ID).toBe('monobungsya.id');
    expect(environment.WEBAUTHN_RP_NAME).toBe('Monobungsya ERP');
  });

  it('falls back to localhost when the web app url is unusable', () => {
    const environment = loadAuthEnv({
      NODE_ENV: 'test',
      PORT: '3101',
      WEB_APP_URL: 'not a url',
    });

    expect(environment.WEBAUTHN_RP_ID).toBe('localhost');
  });
});

describe('passkey labels', () => {
  it('names a recognised authenticator', () => {
    const aaguid = normalizeAaguid('fbfc3007-154e-4ecc-8c0b-6e020557d7bd');

    expect(aaguid).toBe('fbfc3007-154e-4ecc-8c0b-6e020557d7bd');
    expect(authenticatorName(aaguid)).toBe('iCloud Keychain');
    expect(defaultPasskeyLabel(aaguid, new Date('2026-08-21T03:00:00Z'))).toBe(
      'iCloud Keychain',
    );
  });

  it('normalises case so a recognised authenticator still matches', () => {
    expect(normalizeAaguid('FBFC3007-154E-4ECC-8C0B-6E020557D7BD')).toBe(
      'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
    );
  });

  it('treats the all zero and malformed aaguids as absent', () => {
    expect(normalizeAaguid('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(normalizeAaguid('not-a-uuid')).toBeNull();
    expect(normalizeAaguid(undefined)).toBeNull();
  });

  it('falls back to a dated label for an unknown authenticator', () => {
    expect(defaultPasskeyLabel(null, new Date('2026-08-21T03:00:00Z'))).toBe(
      'Passkey 2026-08-21',
    );
    expect(
      defaultPasskeyLabel(
        '11111111-2222-3333-4444-555555555555',
        new Date('2026-01-05T22:30:00Z'),
      ),
    ).toBe('Passkey 2026-01-05');
  });
});
