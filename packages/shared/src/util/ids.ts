/**
 * Runtime-agnostic identity helpers. These run in both the browser bundle and
 * the Node services, so they use WebCrypto (present in Node >= 20 and all
 * supported browsers) rather than `node:crypto`.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix: string): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export async function sha256(input: ArrayBufferView | ArrayBuffer | string): Promise<string> {
  const data =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  // `data` is a view over a plain ArrayBuffer here, which digest() accepts.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministic cache key for an adaptation artefact.
 * Spec section 24: "Cache adaptation plans by source hash + device profile version + engine version."
 */
export function adaptationCacheKey(parts: {
  sourceHash: string;
  deviceId: string;
  deviceCatalogVersion: string;
  engineVersion: string;
  options: unknown;
}): Promise<string> {
  return sha256(
    [
      parts.sourceHash,
      parts.deviceId,
      parts.deviceCatalogVersion,
      parts.engineVersion,
      stableStringify(parts.options ?? {}),
    ].join('|'),
  );
}

/** JSON.stringify with sorted object keys so cache keys are order-independent. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
