/**
 * Convert the single-file standalone build into an Artifact body document.
 *
 * The Artifact host supplies its own <!doctype>, <html>, <head> and <body>, so
 * the published file must contain only the page's own content: the title, the
 * stylesheet, the mount point and the bundle. This lifts exactly those out of
 * the Vite output rather than hand-maintaining a second copy of the page.
 *
 *   node apps/web/scripts/to-artifact.mjs <in.html> <out.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: to-artifact.mjs <in.html> <out.html>');
  process.exit(1);
}

const html = readFileSync(input, 'utf8');

const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
if (!title) throw new Error('The build output has no <title>.');

const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
  attrs: m[1],
  body: m[2],
}));
const bodyInner = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]?.trim() ?? '<div id="root"></div>';

for (const script of scripts) {
  if (/\bsrc=/.test(script.attrs)) {
    throw new Error('An external <script src> survived the single-file build; it would be blocked when published.');
  }
}

// `crossorigin` is meaningless on an inline script and only adds noise.
const scriptTag = (script) => {
  const type = /type=("|')module\1/.test(script.attrs) ? ' type="module"' : '';
  return `<script${type}>${script.body}</script>`;
};

const parts = [
  `<title>${title}</title>`,
  ...styles.map((css) => `<style>${css}</style>`),
  bodyInner,
  ...scripts.map(scriptTag),
];

writeFileSync(output, `${parts.join('\n')}\n`, 'utf8');

const bytes = Buffer.byteLength(readFileSync(output));
console.log(`Wrote ${output}`);
console.log(`  title:   ${title}`);
console.log(`  styles:  ${styles.length}`);
console.log(`  scripts: ${scripts.length}`);
console.log(`  size:    ${(bytes / 1024).toFixed(0)} KB`);
