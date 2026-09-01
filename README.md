# Device Adaptation + Real Device Preview Engine

Upload one mobile design → choose any phone → see the same design rendered for
that device → compare multiple phones → inspect exact measurements → receive a
self-validation report.

The designer's job is to upload the design and choose devices. The system's job
is to understand the device and do the technical adaptation, rendering and
validation **without changing the design**.

## What this is, and what it is not

This is a **device-aware browser preview** built from documented device
parameters — published viewport sizes, safe-area insets, cutout geometry,
pixel ratios and platform conventions — combined with an explicit confidence
model.

It is **not** a physical-device emulator. It does not reproduce OEM font
rendering, GPU compositing, or browser-specific layout quirks. Every validation
report states this, along with anything else it could not verify. Nothing in the
product claims "pixel perfect" unless a measurement actually supports it.

---

## Quick start

Requirements: Node ≥ 20.11 and [pnpm](https://pnpm.io) 9.

```bash
pnpm install                 # install workspace dependencies
cp .env.example .env         # defaults need no external services
pnpm catalog:sync            # generate the normalized device catalog
pnpm build                   # build shared packages, API and web app
pnpm dev                     # API on :4000, web app on :5173
```

Open <http://localhost:5173> and drop in a PNG, JPEG or WebP export of a mobile
design — typically a 375px-wide artboard, and typically long and scrollable.

Out of the box the app runs with **no database, no Redis, no object store and
no AI provider**: it persists to JSON files under `.data/`, stores assets under
`.storage/`, runs jobs in-process, and uses only deterministic analysis. Each of
those is a one-line change in `.env` when you want the real thing.

### Individual commands

```bash
pnpm dev:api            # API only (tsx watch)
pnpm dev:web            # web app only (Vite)
pnpm dev:worker         # background worker: scheduled catalog ingestion
pnpm typecheck          # project-wide TypeScript build
pnpm test               # unit + integration tests (Vitest)
pnpm test:e2e           # acceptance scenario in a real browser (Playwright)
pnpm lint               # ESLint
pnpm catalog:sync       # regenerate the device catalog from its providers
pnpm catalog:sync -- --dry   # report what would change, write nothing
pnpm catalog:verify     # fail if the committed catalog is stale
pnpm build:clean        # wipe build output (including tsbuildinfo) and rebuild
pnpm db:generate        # Prisma client (only for STORAGE_DRIVER=postgres)
pnpm db:migrate         # apply migrations
```

`pnpm test:e2e` covers the acceptance scenario and runs automated axe-core
accessibility checks against the live UI. It expects both servers to be
running. Set
`PLAYWRIGHT_START_SERVERS=1` to have Playwright start them, and
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome` if your CI image ships a Chromium
whose build does not match the pinned Playwright version.

---

## The hard rules

These are enforced in code, not just documented.

| Rule | How it is enforced |
| --- | --- |
| The source is never modified or overwritten | `SourceDocument` is write-once; both repository drivers reject an overwrite. Re-importing identical bytes reuses the existing source. |
| The design is never redesigned or restyled | The adaptation engine has no transform that can change a font, colour, weight or hierarchy. The typography check asserts this invariant on every run and fails if it is ever violated. |
| A bitmap stays the authoritative artwork | Raster sources render as exactly one image node. Any CV/OCR output lands in a separate `analysisOverlay` the renderer never draws. |
| Device chrome never touches the design | Chrome is a sibling rendering layer. Toggling it cannot change the design layer's geometry — there is an end-to-end test asserting the box is byte-identical before and after. |
| Long pages are never cropped to the frame | Scroll extent is computed from the full document and the scroll-completeness check fails if content would be unreachable. |
| Measurements are never invented | Every value carries `detected`, `inferred` or `unavailable`, end to end from the IR through to the inspector and validation panel. |
| Every target links back to its source | Plans, reports and exports all carry `sourceId`, `sourceHash`, device id and engine versions. |
| Uncertainty is surfaced, not hidden | Skipped checks, low-confidence device data and inferred assumptions all appear in the product's Limitations tab. |

---

## How adaptation works

```
SOURCE → PARSE → NORMALIZE → ANALYZE → TARGET DEVICE PROFILE
       → ADAPTATION PLAN → RENDER → VALIDATE → CORRECT → RENDER → VALIDATE
```

The engine picks the **least invasive** strategy that makes the source render
correctly:

| Strategy | When | What happens |
| --- | --- | --- |
| `identity` | Target viewport width equals the source frame width | Nothing is scaled or reflowed. Only chrome is layered on top. Preservation 100/100. |
| `uniform-scale` | The source is an immutable bitmap | The whole document scales proportionally. Every proportion, type size and spacing keeps its original relationship, and nothing is cropped. |
| `structural-reflow` | The source carries real structure (Figma constraints, Auto Layout) | Type sizes, weights, colours and spacing are unchanged. The width difference is absorbed by the source's own layout rules. |

### The safe-area subtlety

A 375×812 artboard almost certainly already reserves ~44–50px for the status
bar. Naively adding a target's 62px inset would push the design down twice.

The engine infers the safe area the **source** assumes by matching its frame
against the device catalog, then applies only the **difference**:

```
375×812 → matches iPhone 13 mini → source assumes 50px top
target iPhone 16 Pro              → 62px top
applied                           → 12px
```

That inference and its basis (`exact-device-match`, `width-match`,
`assumed-zero`) are recorded on the plan and shown in the validation panel, so a
low-confidence assumption is visible rather than silent.

### Every change is auditable

An `AdaptationPlan` records each transformation with source node, target node,
type, before/after values, a plain-language reason, a confidence, and its blast
radius — `none`, `chrome-only`, `layout` or `pixels`. Chrome-only work never
costs preservation score, because it does not touch the designer's pixels.

---

## Validation

All fourteen checks from the specification run on every adaptation:

visual comparison · geometry · typography · overflow/clipping · safe-area
collision · cutout collision · bottom-navigation collision · scroll completeness
· text overflow/wrapping · image crop/scale · missing assets · font availability
· contrast/accessibility · device-profile integrity

Then the engine applies **technical corrections only** — re-anchoring an element
that collides with system UI, or extending a scroll extent that would hide
content — re-renders, and **validates again**. The second pass is mandatory and
always runs, so the report always describes a verified end state.

The engine never changes colour, type, hierarchy or content to satisfy a check.

### Honest results

- A check that cannot run reports `skipped` **with the reason**, and that reason
  appears in the report's limitations. The pixel-level visual comparison, for
  instance, is skipped rather than assumed when no rendered capture exists.
- Checks distinguish an inset the source already reserved from one the target
  newly introduces, so they report real regressions rather than inherited design
  decisions.
- When the browser reports real DOM measurements back, predicted values are
  upgraded from `inferred` to `detected` and the report's confidence rises.

---

## Device intelligence

Device data is **data, not code**. Adding a phone means adding a provider record
and re-running `pnpm catalog:sync` — no application change.

**Sources, in precedence order**

1. **Apple** — technical specifications for viewport, resolution, DPR and PPI;
   Human Interface Guidelines for safe areas, status bar, Dynamic Island and the
   home indicator.
2. **Android** — developer documentation for window insets, display cutouts,
   density buckets and navigation modes; manufacturer specifications for panel
   resolution and density.
3. **Community measurement** — used only where no vendor value is published
   (display corner radii, keyboard heights), always at reduced confidence.
4. **Browser emulation metadata** — lowest precedence, may only *confirm*
   viewport and DPR. If it disagrees with an authoritative source, the
   authoritative value wins and the disagreement is recorded as a caveat.

**The normalizer never blindly trusts its input.** It cross-checks
`logical × DPR` against the physical resolution and reports any mismatch, and it
derives a cutout-aware top inset rather than shipping a status-bar height that a
punch-hole would visibly contradict.

Every field carries its own source, confidence and reference; the device drawer
shows all of them. The headline `overallConfidence` is the worst confidence
among the geometry-critical fields, and it caps the preservation score.

Units are explicit throughout: everything is **logical (CSS) pixels** except
`physicalResolution` and `ppi`, with `physicalPx = logicalPx × devicePixelRatio`
as the only sanctioned conversion.

The seed catalog ships 34 profiles spanning 360, 375, 390, 393, 402, 412, 428,
430, 440 and 448px logical widths, both Android navigation modes, and DPRs from
2 to 3.75.

---

## Dev Mode

Off by default and deliberately unobtrusive. When enabled, tapping any element
opens a measurement panel — Typography, Box, Spacing, Layout, Position,
Device/Safe Area, Source — with code-like rows:

```
font-size:      14px
line-height:    20px       inferred
padding-left:   16px
gap:            12px
x:              16px
distance-to-safe-top: 26px
source-node-id: 1:42
```

Anchor a second element to see the distance between them, drawn and numbered.
Inspecting never alters the design; there is a test asserting the rendered box
is unchanged before and after.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map, data flow,
  rendering layers, caching and extension points
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) — every dependency, why it is
  there, its licence and its official source
- [`docs/DEVICE-DATA.md`](docs/DEVICE-DATA.md) — data sources, the confidence
  model, and how to add a device
- [`.env.example`](.env.example) — every environment variable, documented

## Known limitations

These are real and visible in the product, not hidden here.

- **Browser preview, not a device.** Font rasterisation, GPU compositing and
  browser layout quirks are not reproduced.
- **Server-side text measurement is approximate.** Wrap prediction uses
  published Helvetica metrics adjusted for weight and tracking, because the
  server does not have the font binary. It is always labelled `inferred`; the
  browser's real measurements supersede it as soon as the preview paints.
- **Pixel comparison requires a capture, and only for raster sources.**
  Comparing a structured Figma design against a screenshot would measure the
  renderer, not the adaptation, so it is skipped with that reason.
- **Image export covers raster sources.** The browser cannot rasterise arbitrary
  DOM without a third-party library; for structured sources the export reports
  that plainly instead of producing a blank file. JSON exports are unaffected.
- **Android insets vary by OEM, skin and OS version.** They are carried at
  `medium` confidence with an explicit caveat rather than presented as exact.
- **Newly announced devices** inherit geometry from their closest sibling until
  re-measured, at `medium` confidence with a caveat naming the assumption.
- **The S3 asset driver is not implemented.** `ASSET_STORE=s3` is rejected at
  startup rather than silently falling back to local disk.
- **The worker currently runs catalog ingestion only.** Render and validation
  jobs go through the same `JobQueue` port and run in-process by default; the
  BullMQ path is wired but is not the default.
