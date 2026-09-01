import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two build modes:
 *
 *   default            client for the API, code-split, assets emitted separately
 *   VITE_STANDALONE    one self-contained HTML file that runs the real engine
 *                      and the full device catalog in the browser, with no
 *                      server at all
 */
const standalone = process.env['VITE_STANDALONE'] === 'true';

export default defineConfig({
  plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
  // Asset URLs are resolved against VITE_API_BASE_URL by the client, so no
  // dev-server proxy is needed.
  server: { port: 5173 },
  preview: { port: 5173 },
  build: {
    outDir: standalone ? 'dist-standalone' : 'dist',
    sourcemap: !standalone,
    target: 'es2022',
    // Not the default "assets": the API serves uploaded designs from /assets,
    // and the two must not collide when both are served from one origin.
    assetsDir: 'static',
    // Inline the sample designs and the catalog so the page is one file.
    assetsInlineLimit: standalone ? 10 * 1024 * 1024 : 4096,
  },
});
