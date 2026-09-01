/**
 * Regenerates the 375px-wide long-scroll design the acceptance scenario uses.
 * Run with `pnpm --filter @dae/api exec node ../../e2e/fixtures/make-design.mjs`
 * so Sharp resolves; the PNG output is committed as a fixture.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const W = 375;
const H = 2400;
let body = `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
body += `<rect x="0" y="0" width="${W}" height="88" fill="#111111"/>`;
body += `<text x="16" y="70" font-family="Helvetica" font-size="22" fill="#ffffff">Good morning</text>`;
for (let i = 0; i < 8; i += 1) {
  const y = 108 + i * 260;
  body += `<rect x="16" y="${y}" width="343" height="240" rx="12" fill="#f2f2f5"/>`;
  body += `<text x="32" y="${y + 40}" font-family="Helvetica" font-size="16" fill="#111111">Card ${i + 1}</text>`;
}
body += `<rect x="0" y="${H - 56}" width="${W}" height="56" fill="#111111"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
const out = resolve(dirname(fileURLToPath(import.meta.url)), 'design-375.png');
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`Wrote ${out}`);
