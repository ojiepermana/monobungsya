import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { createSecret, hashSecret } from './auth.crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface EncryptedTotpSecret {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');

  if (key.length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must be a base64 encoded 32 byte key');
  }

  return key;
}

export function encryptTotpSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  const payload: EncryptedTotpSecret = {
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };

  return JSON.stringify(payload);
}

export function decryptTotpSecret(value: string, key: Buffer): string {
  const payload = JSON.parse(value) as EncryptedTotpSecret;

  if (
    payload.version !== 1 ||
    typeof payload.iv !== 'string' ||
    typeof payload.tag !== 'string' ||
    typeof payload.ciphertext !== 'string'
  ) {
    throw new Error('Invalid encrypted TOTP secret');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function createTotp(): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: 'Monobungsya',
    label: 'Monobungsya',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
}

export function createEnrollmentTotp(
  secret: string,
  issuer: string,
  email: string,
): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

export function generateRecoveryCode(): string {
  return createSecret(10).replace(/[-_]/g, '').slice(0, 12).toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return hashSecret(code.trim().toUpperCase());
}

export function normalizedTotpCode(code: string): string {
  return code.replace(/\s/g, '');
}
