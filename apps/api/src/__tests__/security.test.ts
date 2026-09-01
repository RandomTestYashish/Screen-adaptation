import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Env must be valid before anything imports the config.
beforeAll(() => {
  process.env['ASSET_DIR'] = mkdtempSync(join(tmpdir(), 'dae-assets-'));
  process.env['ASSET_URL_SECRET'] = 'test-secret-value-1234567890';
  process.env['ASSET_URL_TTL_SECONDS'] = '900';
});

describe('filename sanitisation', () => {
  it('strips directory components and unsafe characters', async () => {
    const { sanitiseFilename } = await import('../sources/import.service.js');
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('C:\\Users\\me\\design.png')).toBe('design.png');
    // Angle brackets and parentheses are dropped, so a filename can never be
    // reflected as markup.
    expect(sanitiseFilename('<script>alert(1)</script>.png')).toBe('script.png');
    expect(sanitiseFilename('home screen v2.png')).toBe('home screen v2.png');
  });

  it('never returns an empty name', async () => {
    const { sanitiseFilename } = await import('../sources/import.service.js');
    expect(sanitiseFilename('@@@@')).toBe('source');
    expect(sanitiseFilename('')).toBe('source');
  });

  it('bounds the length', async () => {
    const { sanitiseFilename } = await import('../sources/import.service.js');
    expect(sanitiseFilename('a'.repeat(500)).length).toBe(120);
  });
});

describe('signed asset URLs', () => {
  it('accepts a freshly signed URL and rejects a tampered one', async () => {
    const { LocalAssetStore } = await import('../assets/asset-store.js');
    const store = new LocalAssetStore();
    const url = store.signedUrl('asset_abc123');
    const params = new URLSearchParams(url.split('?')[1]);
    const expires = params.get('expires')!;
    const signature = params.get('signature')!;

    expect(store.verify('asset_abc123', expires, signature)).toBe(true);
    // A different asset id must not validate against this signature.
    expect(store.verify('asset_other', expires, signature)).toBe(false);
    // Nor a different expiry.
    expect(store.verify('asset_abc123', String(Number(expires) + 60), signature)).toBe(false);
    // Nor a mangled signature of the same length.
    expect(store.verify('asset_abc123', expires, `${signature.slice(0, -1)}0`)).toBe(false);
  });

  it('rejects an expired URL even when correctly signed', async () => {
    const { LocalAssetStore } = await import('../assets/asset-store.js');
    const store = new LocalAssetStore();
    const past = String(Math.floor(Date.now() / 1000) - 10);
    // Sign the past expiry through the same code path the store uses.
    const url = store.signedUrl('asset_abc123');
    const signature = new URLSearchParams(url.split('?')[1]).get('signature')!;
    expect(store.verify('asset_abc123', past, signature)).toBe(false);
  });

  it('rejects a non-numeric expiry', async () => {
    const { LocalAssetStore } = await import('../assets/asset-store.js');
    const store = new LocalAssetStore();
    expect(store.verify('asset_abc123', 'not-a-number', 'x'.repeat(64))).toBe(false);
  });

  it('refuses an asset id that could escape the asset directory', async () => {
    const { LocalAssetStore } = await import('../assets/asset-store.js');
    const store = new LocalAssetStore();
    for (const id of ['../secret', 'a/b', 'a\\b', '']) {
      expect(store.has(id)).toBe(false);
      expect(() => store.signedUrl(id) && store.verify(id, '1', 'x')).not.toThrow();
    }
  });
});

describe('export data URLs', () => {
  it('accepts a well-formed PNG data URL', async () => {
    const { decodeDataUrl } = await import('../exports/exports.controller.js');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    expect(decodeDataUrl(`data:image/png;base64,${png}`, 1024).length).toBe(4);
  });

  it('rejects a non-image or malformed data URL', async () => {
    const { decodeDataUrl } = await import('../exports/exports.controller.js');
    for (const value of [
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'https://example.com/image.png',
      'data:image/png;base64,not base64!!',
    ]) {
      expect(() => decodeDataUrl(value, 1024)).toThrow();
    }
  });

  it('enforces the size limit', async () => {
    const { decodeDataUrl } = await import('../exports/exports.controller.js');
    const big = Buffer.alloc(2048).toString('base64');
    expect(() => decodeDataUrl(`data:image/png;base64,${big}`, 1024)).toThrow(/limit is 1024/);
  });
});

describe('environment validation', () => {
  it('rejects a production deployment that keeps the default asset secret', async () => {
    const { parseEnv } = await import('../config/env.js');
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ASSET_URL_SECRET: 'dev-only-change-me-in-production',
      } as NodeJS.ProcessEnv),
    ).toThrow(/ASSET_URL_SECRET/);
  });

  it('requires the dependencies each driver needs', async () => {
    const { parseEnv } = await import('../config/env.js');
    expect(() => parseEnv({ STORAGE_DRIVER: 'postgres' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ QUEUE_DRIVER: 'bullmq' } as NodeJS.ProcessEnv)).toThrow(/REDIS_URL/);
    expect(() => parseEnv({ ASSET_STORE: 's3' } as NodeJS.ProcessEnv)).toThrow(/S3_BUCKET/);
    expect(() => parseEnv({ AI_PROVIDER: 'openai' } as NodeJS.ProcessEnv)).toThrow(/OPENAI_API_KEY/);
  });
});
