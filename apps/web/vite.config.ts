import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Asset URLs are resolved against VITE_API_BASE_URL by the client, so no
  // dev-server proxy is needed.
  server: { port: 5173 },
  preview: { port: 5173 },
  build: {
    sourcemap: true,
    target: 'es2022',
    // Not the default "assets": the API serves uploaded designs from /assets,
    // and the two must not collide when both are served from one origin.
    assetsDir: 'static',
  },
});
