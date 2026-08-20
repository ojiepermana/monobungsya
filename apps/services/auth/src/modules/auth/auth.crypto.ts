import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function signIdentity(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function verifyIdentitySignature(
  value: string,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signIdentity(value, secret), "hex");
  const received = Buffer.from(signature, "hex");

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
