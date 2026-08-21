export type ChallengeType = "registration" | "authentication";

/** A stored credential, in the shape SimpleWebAuthn needs to verify an assertion. */
export interface StoredCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[] | null;
}

/** The public view of a credential. The public key is never part of it. */
export interface PasskeySummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  backupState: boolean;
}

export interface NewCredential {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[] | null;
  aaguid: string | null;
  label: string;
  backupEligible: boolean;
  backupState: boolean;
}

export interface ExcludedCredential {
  credentialId: string;
  transports: string[] | null;
}

/**
 * What the service reports back after running the WebAuthn attestation check.
 * The repository routes on it and never verifies anything itself.
 */
export type AttestationCheck =
  | { status: "ok"; credential: NewCredential }
  | { status: "verification_failed"; reason: string };

/**
 * What the service reports back after running the WebAuthn assertion check.
 * `counter_regression` means the signature was valid but the counter went
 * backwards, which can mean a cloned authenticator.
 */
export type AssertionCheck =
  | { status: "ok"; newCounter: number }
  | { status: "counter_regression"; newCounter: number }
  | { status: "verification_failed"; reason: string };
