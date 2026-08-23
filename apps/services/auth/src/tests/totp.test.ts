import { describe, expect, it } from 'bun:test';
import {
  createEnrollmentTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  hashRecoveryCode,
  parseEncryptionKey,
} from '../modules/auth/totp.crypto';

const key = Buffer.alloc(32, 7);
const secret = 'JBSWY3DPEHPK3PXP';

describe('TOTP crypto helpers (spec 0009)', () => {
  it('encrypts and decrypts the authenticator secret with AES GCM', () => {
    const encrypted = encryptTotpSecret(secret, key);

    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted, key)).toBe(secret);
    expect(() => decryptTotpSecret(encrypted, Buffer.alloc(32, 8))).toThrow();
  });

  it('rejects an encryption key that is not exactly 32 decoded bytes', () => {
    expect(() =>
      parseEncryptionKey(Buffer.alloc(31).toString('base64')),
    ).toThrow('32 byte key');
  });

  it('generates one time recovery codes with stable hashes', () => {
    const code = generateRecoveryCode();

    expect(code).toMatch(/^[A-Z0-9]{12}$/);
    expect(hashRecoveryCode(` ${code.toLowerCase()} `)).toBe(
      hashRecoveryCode(code),
    );
  });

  it('accepts a current authenticator token', () => {
    const totp = createEnrollmentTotp(
      secret,
      'Monobungsya',
      'user@example.com',
    );
    const token = totp.generate();

    expect(totp.validate({ token, window: 1 })).not.toBeNull();
  });
});
