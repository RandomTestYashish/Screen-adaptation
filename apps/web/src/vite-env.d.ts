/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Unused in the standalone build. */
  readonly VITE_API_BASE_URL?: string;
  /** "true" selects the in-browser backend and a single-file bundle. */
  readonly VITE_STANDALONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '@dae/device-catalog/catalog.json' {
  import type { DeviceCatalog } from '@dae/shared';
  const catalog: DeviceCatalog;
  export default catalog;
}
