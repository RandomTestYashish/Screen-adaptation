# Architecture

One repository, one system. The pipeline is shared: the API, the worker and the
browser all consume the same schemas and the same engine.

## Module map

```
packages/
  shared/                 Single source of truth. Zod schemas + TS types.
    design-ir/            Document → screens → nodes, with per-field provenance
    device/               DeviceProfile, attribution and confidence model
    adaptation/           AdaptationPlan, TransformRecord, PreservationScore
    validation/           ValidationReport, checks, findings, metadata rows
                          fidelity: the source/adaptation pair, MeasurementType
    api/                  Request/response contracts used by BOTH sides
    util/                 versions (cache keys), ids, stable hashing

  device-catalog/         Device data as data, never as code
    schema/               RawDeviceRecord + DeviceDataProvider interface
    providers/            apple, android, browser-emulation (supplemental)
    normalizer/           cross-checks, derivations, precedence merging
    data/catalog.json     Generated, versioned, committed seed catalog
    scripts/              sync (scheduled ingestion) and verify (CI freshness)

  engine/                 Pure, deterministic, runtime-agnostic
    layout/               geometry helpers, browser-free text measurement
    imports/              raster + figma → Design IR, anchor detection
    reconstruction/       bitmap → semantic components (deterministic CV)
      pixels              OKLab colour distance, modal colour, uniformity
      segmentation        background, bands, connected components, radii
      text-detection      ink profiles, baselines, stroke-weight estimation
      design-dna          palette, type scale, spacing rhythm, grid, radii
      classify            component type + RECONSTRUCT/HYBRID/PRESERVE_RASTER
      reconstruct         orchestrator producing hybrid IR
      fidelity            source-fidelity scoring
    adaptation/           planner, constraint rules, safe-area inference
                          fidelity: adaptation-fidelity scoring
    validation/           14 checks, two-pass runner, metadata rows

apps/
  api/                    NestJS. Thin services over the engine.
    storage/              Repository port + filesystem and Prisma drivers
    assets/               Asset store + signed-URL controller
    devices/              Catalog queries and guarded runtime sync
    sources/              Upload and Figma import
    adaptations/          Plan and render, with cache lookup
    validations/          Two-pass run + pixelmatch comparator
    exports/              PNG/JPEG/WebP and JSON, with provenance
    fonts/                Platform font availability
    ai/                   AIAdapter: null by default, OpenAI behind a gate
    queue/                JobQueue: in-process by default, BullMQ optional
    prisma/schema.prisma  PostgreSQL schema

  web/                    React + TypeScript + Vite
    renderer/             The five rendering layers, plus the device overlay
    components/           workspace, device-explorer, dev-mode, ai-mode,
                          validation-panel, upload
    state/                Zustand workspace store
    hooks/                render → validate orchestration
    lib/                  typed API client, DOM-to-canvas capture,
                          in-browser backend for the standalone build

  worker/                 Scheduled device-catalog ingestion; BullMQ consumers
```

The specification's `services/` and `src/` layouts map onto this as follows:
`import-service` → `apps/api/src/sources` + `packages/engine/src/imports`;
`device-catalog-service` → `apps/api/src/devices` + `packages/device-catalog`;
`adaptation-service` and `render-service` → `apps/api/src/adaptations` +
`packages/engine/src/adaptation`; `validation-service` →
`apps/api/src/validations` + `packages/engine/src/validation`; `ai-service` →
`apps/api/src/ai`; `asset-service` → `apps/api/src/assets`.

The engine is deliberately separate from the API so the same code can run in a
worker, in a test, or (in future) in the browser, without dragging a web
framework along.

## Data flow

```
                 ┌────────────┐
  PNG/JPEG/WebP ─┤            │
                 │  Import    ├─► SourceDocument (immutable, hashed, write-once)
  Figma frame ───┤            │        │
                 └────────────┘        │
                                       ▼
                          Reconstruction (raster only)
                          background → segmentation → text
                          → classification → Design DNA
                                       │
                                       ▼
                                  Design IR ──► cached
                                  structure: figma | reconstructed | flat
                                  sourceFidelity
                                       │
        DeviceProfile (normalized) ────┤
                                       ▼
                              planAdaptation()
                                       │
                             AdaptationPlan + AdaptedNode[]
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
           Browser renderer     runValidation()          Exports
           (5 layers)            pass 1                  (+ provenance)
                  │                    │
        real DOM measurements ─────────┤ corrections (technical only)
                  │                    ▼
                  └──────────────► re-plan → pass 2 → ValidationReport
```

Two properties hold throughout:

1. **The source is read-only.** Nothing downstream can write back to it. Adapted
   output is always a separate artefact carrying `sourceId` + `sourceHash`.
2. **The design is never rasterised server-side for the preview.** The browser
   renders the Design IR (or the original bitmap) directly, so a structured
   Figma design is never flattened into an image.
3. **`structure`, not `sourceKind`, decides how a design adapts.** A bitmap that
   has been reconstructed into components reflows exactly like a Figma import; a
   bitmap that has not can only be scaled. Keying the decision on the source
   *format* was the reason an uploaded screenshot used to shrink to fit instead
   of revealing more or less content per viewport.
4. **Reconstruction never replaces the reference.** It is a parallel
   representation. Regions it cannot describe confidently render as normalized
   crops of the original file, so those pixels are the designer's own.

## The five rendering layers

Each is an independent sibling. None can modify another.

| Layer | Component | Contents |
| --- | --- | --- |
| A | `DeviceShell` | Cosmetic bezel and screen corners, driven entirely by `DeviceProfile` geometry. No per-model artwork exists anywhere in the codebase. |
| B | `PlatformChrome` | Status bar, notch / Dynamic Island / punch-hole, home indicator, Android gesture or three-button navigation, optional keyboard. `pointer-events: none`. |
| C | `SafeAreaOverlay` | Inset visualisation, distinguishing what the source already reserved from what this device adds. |
| D | `DesignRenderer` | **The only layer carrying the designer's pixels.** A real scroll container holds the full document; fixed elements render outside it, pinned to the viewport. |
| E | `InspectionOverlay` | Dev Mode boxes, padding bands, distance guides, validation finding regions. `DeviceOverlay` — viewport bounds, safe-area bands and margin guides — is part of this layer and is off by default. |

Layer D virtualises subtrees outside a windowed range while keeping the document
at its full height, so scroll geometry stays exact on very long pages.

## Caching

`cacheKey = sha256(sourceHash | deviceId | catalogVersion | engineVersion | options)`

A cached plan is returned without re-running anything, so switching devices is a
lookup rather than a pipeline run. Any change to the parser, the engine, the
catalog or the options produces a different key — the version constants in
`packages/shared/src/util/versions.ts` exist for exactly this, and must be
bumped whenever semantics change.

The Design IR is cached per source; normalized `DeviceProfile`s are loaded once
per catalog version.

## Swappable adapters

Everything environment-specific sits behind an interface, selected by
environment variable and validated at boot:

| Port | Default | Alternative |
| --- | --- | --- |
| `Repository` | Filesystem JSON (`.data/`) | Prisma + PostgreSQL |
| `AssetStore` | Local disk + HMAC-signed expiring URLs | S3-compatible (interface defined; driver not implemented, and `ASSET_STORE=s3` is rejected rather than silently falling back) |
| `JobQueue` | In-process | BullMQ + Redis |
| `AIAdapter` | None — deterministic only | OpenAI, behind an explicit upload gate |
| `DeviceDataProvider` | Apple + Android | Any provider implementing the interface |
| `VisualComparator` | pixelmatch | Any implementation |

The default configuration needs no external service, which is what makes
`pnpm dev` a single command.

## Security

- Uploads: MIME allow-list **verified against decoded content**, size limits,
  sanitised filenames, opaque generated asset ids.
- Assets are private: served only via HMAC-signed, expiring URLs, compared in
  constant time. Asset ids are pattern-validated, so no path can escape the
  store.
- Secrets (Figma token, AI key) are server-side only. A per-request Figma token
  is used for that request and never stored.
- User artwork is never sent to a third party unless `AI_ALLOW_SOURCE_UPLOAD` is
  explicitly `true`, even when an API key is present.
- Three rate-limit budgets: a general one; a tighter one on the routes that do
  real image work (upload, Figma import, export); and a generous one for signed
  asset reads, where the control is the signature rather than a budget.
  Planning, rendering and validation use the general budget, because they are
  cache lookups and millisecond-scale structural work — throttling them would
  penalise ordinary device switching.
- The catalog-sync endpoint is closed unless `ADMIN_API_TOKEN` is configured.
- Errors are structured; internal details never reach the client.

## Extending

**Add a device** — add a record to a provider, run `pnpm catalog:sync`. The
normalizer validates it, and `pnpm catalog:verify` keeps CI honest.

**Add a data source** — implement `DeviceDataProvider` and give it a precedence.
Higher precedence wins per device; supplements can confirm but never override.

**Add a source format** — implement an importer that returns a `DesignDocument`.
Adaptation, rendering, inspection and validation need no changes.

**Add a validation check** — add the id to `ValidationCheckIdSchema`, write the
check, register it in the runner. Give it an `autoCorrectable` hint only if the
correction is genuinely technical.

**Add a transformation** — add the type to `TransformTypeSchema` and emit a
`TransformRecord` with an honest `impact`. The preservation score and the audit
trail pick it up automatically.
