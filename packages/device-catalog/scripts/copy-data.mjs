import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../data/catalog.json');
const destDir = resolve(here, '../dist/data');
if (existsSync(src)) {
  mkdirSync(destDir, { recursive: true });
  cpSync(src, resolve(destDir, 'catalog.json'));
}
