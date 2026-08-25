import { createHmac } from 'node:crypto';
import { canonicalJson, sha256 } from '#project/telemetry';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const inputPath = argument('input');
const endpoint = Bun.env.OBSERVABILITY_INGESTION_URL;
const keyId = Bun.env.OBSERVABILITY_INGESTION_KEY_ID;
const secret = Bun.env.OBSERVABILITY_INGESTION_SECRET;

if (!inputPath || !endpoint || !keyId || !secret) {
  throw new Error(
    'benchmark ingestion requires --input, OBSERVABILITY_INGESTION_URL, OBSERVABILITY_INGESTION_KEY_ID, and OBSERVABILITY_INGESTION_SECRET',
  );
}

const body = canonicalJson(JSON.parse(await Bun.file(inputPath).text()));
const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = crypto.randomUUID();
const path = new URL(endpoint).pathname;
const signingInput = ['POST', path, timestamp, nonce, sha256(body)].join('\n');
const signature = createHmac('sha256', secret)
  .update(signingInput)
  .digest('hex');

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-observability-key-id': keyId,
    'x-observability-timestamp': timestamp,
    'x-observability-nonce': nonce,
    'x-observability-signature': `sha256=${signature}`,
  },
  body,
});

const responseBody = await response.text();
if (!response.ok) {
  throw new Error(
    `benchmark ingestion failed with HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
  );
}

console.log(responseBody);
