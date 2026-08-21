import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software authenticator, just enough of one to run real WebAuthn ceremonies
 * in tests: it holds an ES256 key pair, builds authenticator data, and signs
 * assertions the way a real passkey does. Tests can therefore exercise the whole
 * ceremony instead of mocking the verification away.
 */
export interface SoftwareAuthenticatorInit {
  rpId: string;
  origin: string;
  /** 16 byte AAGUID. Zeroes mean "no AAGUID reported", like most platforms. */
  aaguid?: Bytes;
  /** Synced (multi device) credentials set the backup flags. */
  synced?: boolean;
}

/** WebCrypto rejects a Uint8Array over a shared buffer, so the type is pinned. */
type Bytes = Uint8Array<ArrayBuffer>;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export class SoftwareAuthenticator {
  private constructor(
    private readonly init: SoftwareAuthenticatorInit,
    private readonly keyPair: CryptoKeyPair,
    readonly credentialId: Bytes,
    private counter: number,
  ) {}

  static async create(
    init: SoftwareAuthenticatorInit,
  ): Promise<SoftwareAuthenticator> {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );

    return new SoftwareAuthenticator(
      init,
      keyPair,
      crypto.getRandomValues(bytes(32)),
      0,
    );
  }

  get credentialIdBase64Url(): string {
    return base64url(this.credentialId);
  }

  /** The counter the authenticator reports next. Tests can rewind it. */
  setCounter(value: number): void {
    this.counter = value;
  }

  async register(challenge: string): Promise<RegistrationResponseJSON> {
    const clientDataJSON = this.clientData('webauthn.create', challenge);
    const authData = concat([
      await sha256(utf8(this.init.rpId)),
      byte(this.flags(FLAG_AT)),
      counterBytes(++this.counter),
      this.init.aaguid ?? bytes(16),
      lengthBytes(this.credentialId.byteLength),
      this.credentialId,
      await this.coseKey(),
    ]);
    const attestationObject = copy(
      isoCBOR.encode(
        new Map<string, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]) as never,
      ),
    );

    return {
      id: this.credentialIdBase64Url,
      rawId: this.credentialIdBase64Url,
      type: 'public-key',
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  async authenticate(
    challenge: string,
    options: { advanceCounter?: boolean } = {},
  ): Promise<AuthenticationResponseJSON> {
    const clientDataJSON = this.clientData('webauthn.get', challenge);

    if (options.advanceCounter !== false) {
      this.counter += 1;
    }

    const authData = concat([
      await sha256(utf8(this.init.rpId)),
      byte(this.flags()),
      counterBytes(this.counter),
    ]);
    const signed = concat([authData, await sha256(clientDataJSON)]);
    const raw = copy(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        this.keyPair.privateKey,
        signed,
      ),
    );

    return {
      id: this.credentialIdBase64Url,
      rawId: this.credentialIdBase64Url,
      type: 'public-key',
      response: {
        clientDataJSON: base64url(clientDataJSON),
        authenticatorData: base64url(authData),
        // WebAuthn carries EC2 signatures as ASN.1 DER, not raw r||s.
        signature: base64url(toDer(raw)),
        userHandle: undefined,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  private flags(extra = 0): number {
    const backup = this.init.synced ? FLAG_BE | FLAG_BS : 0;

    return FLAG_UP | FLAG_UV | backup | extra;
  }

  private clientData(type: string, challenge: string): Bytes {
    return utf8(
      JSON.stringify({
        type,
        challenge,
        origin: this.init.origin,
        crossOrigin: false,
      }),
    );
  }

  /** The public key as a COSE_Key map, which is what authenticators return. */
  private async coseKey(): Promise<Bytes> {
    const jwk = await crypto.subtle.exportKey('jwk', this.keyPair.publicKey);

    return copy(
      isoCBOR.encode(
        new Map<number, unknown>([
          [1, 2], // kty: EC2
          [3, -7], // alg: ES256
          [-1, 1], // crv: P-256
          [-2, fromBase64Url(jwk.x ?? '')],
          [-3, fromBase64Url(jwk.y ?? '')],
        ]) as never,
      ),
    );
  }
}

function bytes(length: number): Bytes {
  return new Uint8Array(new ArrayBuffer(length));
}

function byte(value: number): Bytes {
  const single = bytes(1);
  single[0] = value;

  return single;
}

function copy(value: Uint8Array | ArrayBuffer): Bytes {
  const source = value instanceof Uint8Array ? value : new Uint8Array(value);
  const target = bytes(source.byteLength);
  target.set(source);

  return target;
}

function utf8(value: string): Bytes {
  return copy(new TextEncoder().encode(value));
}

function concat(parts: Uint8Array[]): Bytes {
  const merged = bytes(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;

  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }

  return merged;
}

async function sha256(value: Bytes): Promise<Bytes> {
  return copy(await crypto.subtle.digest('SHA-256', value));
}

function counterBytes(value: number): Bytes {
  const four = bytes(4);
  new DataView(four.buffer).setUint32(0, value, false);

  return four;
}

function lengthBytes(value: number): Bytes {
  const two = bytes(2);
  new DataView(two.buffer).setUint16(0, value, false);

  return two;
}

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string): Bytes {
  return copy(Uint8Array.from(Buffer.from(value, 'base64url')));
}

/** Wraps a raw r||s ECDSA signature into the ASN.1 DER form WebAuthn uses. */
function toDer(raw: Bytes): Bytes {
  const body = concat([
    derInteger(raw.subarray(0, 32)),
    derInteger(raw.subarray(32)),
  ]);

  return concat([byte(0x30), byte(body.byteLength), body]);
}

function derInteger(component: Uint8Array): Bytes {
  let start = 0;

  while (start < component.byteLength - 1 && component[start] === 0) {
    start += 1;
  }

  const trimmed = component.subarray(start);
  const padded =
    ((trimmed[0] ?? 0) & 0x80) !== 0 ? concat([byte(0), trimmed]) : trimmed;

  return concat([byte(0x02), byte(padded.byteLength), padded]);
}
