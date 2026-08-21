/**
 * Friendly names for authenticators we recognise by AAGUID, used as the default
 * passkey label. An AAGUID that is missing here (or named wrongly) is harmless:
 * the label falls back to a generic name with the registration date, and the
 * user can rename any passkey afterwards.
 */
const KNOWN_AUTHENTICATORS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "cb69481e-8ff7-4039-93ec-0a2729a154a8": "YubiKey 5 Series",
  "ee882879-721c-4913-9775-3dfcce97072a": "YubiKey 5 Series",
  "fa2b99dc-9e39-4257-8f92-4a30d23c4118": "YubiKey 5 Series with NFC",
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": "YubiKey 5 Series with NFC",
  "b93fd961-f2e6-462f-b122-82002247de78": "Android Authenticator",
};

const EMPTY_AAGUID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Normalises what the authenticator reported. Anything that is not a real UUID,
 * including the all zero "no AAGUID" value, becomes null so the column stays
 * meaningful.
 */
export function normalizeAaguid(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (!UUID_PATTERN.test(normalized) || normalized === EMPTY_AAGUID) {
    return null;
  }

  return normalized;
}

export function authenticatorName(aaguid: string | null): string | null {
  return aaguid ? (KNOWN_AUTHENTICATORS[aaguid] ?? null) : null;
}

/** `Passkey 2026-08-21` when the authenticator is not one we recognise. */
export function defaultPasskeyLabel(aaguid: string | null, now: Date): string {
  const known = authenticatorName(aaguid);

  if (known) {
    return known;
  }

  return `Passkey ${now.toISOString().slice(0, 10)}`;
}
