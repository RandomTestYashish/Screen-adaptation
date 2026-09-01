# Dependencies

Every third-party package, why it is here, and where it comes from. All are
actively maintained and pinned to an exact version; no version range is used
anywhere in the workspace.

Licences were checked at the versions pinned below. Everything is MIT except
Playwright and axe-core (Apache-2.0), Prisma (Apache-2.0), and Sharp
(Apache-2.0).

## Shared

| Package | Version | Why | Source |
| --- | --- | --- | --- |
| `zod` | 3.24.1 | Runtime validation for the Design IR, device catalog, adaptation plans and API contracts. The same schema validates on both sides of every request, which is what stops client and server models drifting. | <https://github.com/colinhacks/zod> |
| `typescript` | 5.7.3 | Compile-time types, project references across the workspace. | <https://github.com/microsoft/TypeScript> |

## Frontend

| Package | Version | Why | Source |
| --- | --- | --- | --- |
| `react`, `react-dom` | 18.3.1 | UI runtime. | <https://github.com/facebook/react> |
| `vite` | 6.0.7 | Dev server and production bundler. | <https://github.com/vitejs/vite> |
| `@vitejs/plugin-react` | 4.3.4 | React fast refresh and JSX transform for Vite. | <https://github.com/vitejs/vite-plugin-react> |
| `zustand` | 5.0.2 | Workspace state (panes, device selection, layer toggles, Dev Mode). Chosen over Context because pane updates are frequent and must not re-render the whole tree. | <https://github.com/pmndrs/zustand> |
| `@tanstack/react-query` | 5.62.11 | Fetching and caching for device queries and health, with request deduplication. | <https://github.com/TanStack/query> |
| `@radix-ui/react-*` | 1.x / 2.x | Accessible unstyled primitives — dialog, tabs, accordion, switch, select, tooltip, popover. Keyboard behaviour and focus management are correct by construction, which matters for the accessibility requirements. | <https://github.com/radix-ui/primitives> |

Styling is CSS Modules with custom properties. No CSS framework: the visual
direction is deliberately minimal, and a utility framework would add weight for
no benefit here.

## Backend

| Package | Version | Why | Source |
| --- | --- | --- | --- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | 10.4.15 | Modular service structure with dependency injection, which is what makes the storage / asset / queue / AI adapters swappable by configuration. | <https://github.com/nestjs/nest> |
| `@nestjs/throttler` | 6.3.0 | Two rate-limit budgets, with a tighter one on the expensive routes. | <https://github.com/nestjs/throttler> |
| `helmet` | 8.0.0 | Standard security response headers. | <https://github.com/helmetjs/helmet> |
| `sharp` | 0.33.5 | Reads image dimensions, format and DPI on import, and re-encodes exports. It is used to *read* metadata and to write exports — never to modify the uploaded artwork. | <https://github.com/lovell/sharp> |
| `pixelmatch` | 6.0.0 | Source-vs-target pixel comparison for the visual check. | <https://github.com/mapbox/pixelmatch> |
| `pngjs` | 7.0.0 | PNG decode/encode for the comparison buffers pixelmatch needs. | <https://github.com/pngjs/pngjs> |
| `prisma`, `@prisma/client` | 6.2.1 | PostgreSQL schema, migrations and typed client for the production storage driver. | <https://github.com/prisma/prisma> |
| `bullmq` | 5.34.6 | Redis-backed queue for expensive analysis, render and validation work when running out-of-process. | <https://github.com/taskforcesh/bullmq> |
| `ioredis` | 5.4.2 | Redis client BullMQ builds on. | <https://github.com/redis/ioredis> |
| `reflect-metadata` | 0.2.2 | Decorator metadata NestJS requires. | <https://github.com/rbuckton/reflect-metadata> |
| `rxjs` | 7.8.1 | NestJS peer dependency. | <https://github.com/ReactiveX/rxjs> |

## Testing and tooling

| Package | Version | Why | Source |
| --- | --- | --- | --- |
| `vitest` | 2.1.8 | Unit and integration tests across all packages. | <https://github.com/vitest-dev/vitest> |
| `@playwright/test` | 1.49.1 | End-to-end acceptance scenario in a real browser. | <https://github.com/microsoft/playwright> |
| `@testing-library/react`, `@testing-library/jest-dom` | 16.1.0 / 6.6.3 | Component testing against accessible queries. | <https://github.com/testing-library> |
| `jsdom` | 25.0.1 | DOM environment for component tests. | <https://github.com/jsdom/jsdom> |
| `@axe-core/react` | 4.10.1 | Accessibility checks against the live UI in development. | <https://github.com/dequelabs/axe-core-npm> |
| `eslint`, `@typescript-eslint/*` | 8.57.1 / 8.19.1 | Linting. | <https://github.com/eslint/eslint> |
| `prettier` | 3.4.2 | Formatting. | <https://github.com/prettier/prettier> |
| `tsx` | 4.19.2 | Running TypeScript entry points directly (dev server, catalog scripts). | <https://github.com/privatenumber/tsx> |

## Deliberately not used

- **A DOM-to-canvas library** (`html2canvas`, `dom-to-image`). These rasterise by
  reimplementing CSS and quietly get it wrong, which would make an export
  disagree with the preview it claims to capture. Image export therefore covers
  the case the browser can do faithfully, and says so plainly otherwise.
- **A CSS framework.** The visual system is intentionally minimal.
- **A device-list npm package.** Community device datasets are useful as a
  *supplement*, but they mix logical and physical pixels inconsistently and
  rarely carry provenance. The catalog normalizes from documented sources
  instead, and records confidence per field.
- **An ORM for the default path.** The filesystem driver exists so the app runs
  with zero infrastructure; Prisma is there for real deployments.

## Device data sources

Not code dependencies, but the data the product's correctness rests on. See
[`DEVICE-DATA.md`](DEVICE-DATA.md).

| Source | Used for | Confidence |
| --- | --- | --- |
| Apple technical specifications | iPhone viewport, resolution, DPR, PPI | high |
| Apple Human Interface Guidelines | safe areas, status bar, Dynamic Island, home indicator | high |
| Android developer documentation | window insets, display cutouts, density buckets, navigation | medium — genuinely OEM- and version-dependent |
| Manufacturer specifications | Android panel resolution and density | high |
| Normalized community measurement | display corner radii, keyboard heights (not vendor-published) | low–medium |
| Browser device-emulation metadata | confirming viewport and DPR only | supplemental; never overrides |
