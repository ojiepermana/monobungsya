import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthIdentityRole = "admin" | "manager" | "bi" | "staff" | "legacy";
export type AuthCapability = "admin" | "operational" | "read";

export interface AuthIdentity {
  userId: string;
  email: string;
  role: AuthIdentityRole;
  expiresAt: string;
}

export function canAccessAuthCapability(
  role: AuthIdentityRole,
  capability: AuthCapability,
): boolean {
  if (capability === "read") {
    return true;
  }

  if (capability === "operational") {
    return role !== "legacy";
  }

  return role === "admin" || role === "manager";
}

export function canonicalIdentityInput(
  method: string,
  path: string,
  identity: AuthIdentity,
): string {
  return [
    method.toUpperCase(),
    path,
    identity.userId,
    identity.role,
    identity.expiresAt,
  ].join("\n");
}

export function signAuthIdentity(
  method: string,
  path: string,
  identity: AuthIdentity,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalIdentityInput(method, path, identity), "utf8")
    .digest("hex");
}

export function readAndVerifyAuthIdentity(
  headers: Headers,
  method: string,
  path: string,
  secret: string,
  now = Date.now(),
  clockSkewSeconds = 30,
): AuthIdentity | null {
  const identity: AuthIdentity = {
    userId: headers.get("x-auth-user-id") ?? "",
    email: headers.get("x-auth-email") ?? "",
    role: (headers.get("x-auth-role") ?? "") as AuthIdentityRole,
    expiresAt: headers.get("x-auth-expires-at") ?? "",
  };
  const receivedSignature = headers.get("x-auth-signature") ?? "";
  const expiresAt = Date.parse(identity.expiresAt);
  const expectedSignature = signAuthIdentity(method, path, identity, secret);
  const expected = Buffer.from(expectedSignature, "hex");
  const received = Buffer.from(receivedSignature, "hex");

  if (
    !identity.userId ||
    !identity.email ||
    !["admin", "manager", "bi", "staff", "legacy"].includes(identity.role) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now - clockSkewSeconds * 1000 ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  return identity;
}
