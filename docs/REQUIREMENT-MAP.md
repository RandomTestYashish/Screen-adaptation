# Enhancement requirement map

The enhancement specification asked for this before any code was written:

> First inspect the existing repository … map every requirement to EXISTS /
> NEEDS ENHANCEMENT / NEEDS REFACTOR / MISSING.

This is that map, updated to record what was actually done. Status is the
*starting* state; the right-hand column says what shipped.

| Status | Meaning |
| --- | --- |
| **EXISTS** | Already met the requirement. Untouched, or touched only where a neighbouring change forced it. |
| **ENHANCED** | Was present but incomplete. Extended in place. |
| **REFACTORED** | Was present and worked, but on the wrong basis. Reworked. |
| **MISSING** | Did not exist. Built. |

---

## 1–9 · Viewport behaviour, the central complaint

| § | Requirement | Status | What shipped |
| --- | --- | --- | --- |
| 1 | A screenshot must not simply scale when the device changes | **REFACTORED** | `chooseStrategy` keyed on `sourceKind === 'raster'`, so every bitmap took `uniform-scale`. It is now keyed on `design.structure`, and a reconstructed bitmap reflows like a Figma import. |
| 2 | Never redesign, restyle, recolour or rearrange | **EXISTS** | No transform in the engine can change a font, colour, weight or hierarchy; the typography check asserts the invariant every run. |
| 3 | The source is immutable and stays the reference | **EXISTS** | `SourceDocument` is write-once in both repository drivers. |
| 4 | Device chrome is a separate layer | **EXISTS** | Five independent rendering layers; an end-to-end test asserts the design box is byte-identical across chrome toggles. |
| 5 | Do not force an 8px grid the source does not use | **ENHANCED** | Grid detection tries candidates largest-first and rejects any whose fit is no better than chance, so irregular spacing reports "no grid". |
| 6 | Design DNA must be measured, not assumed | **MISSING** | `design-dna.ts`: clustered palette with roles, type scale, spacing rhythm, radii, edge margin — each carrying a `measurementType`. |
| 7 | Long pages are never cropped | **EXISTS** | Scroll extent comes from the full document; the scroll-completeness check fails if content is unreachable. |
| 8 | Hybrid rendering per region | **MISSING** | `RECONSTRUCT` / `HYBRID` / `PRESERVE_RASTER` chosen per region by confidence, with the thresholds and reasons recorded. |
| 9 | The frame is a document, not a viewport | **REFACTORED** | The authored frame is now the bitmap's own height. How much is visible is the device's business. |

## 10–17 · Reconstruction

| § | Requirement | Status | What shipped |
| --- | --- | --- | --- |
| 10–12 | Segment a screenshot into regions | **MISSING** | `segmentation.ts`: background detection from the side strips only (top/bottom are usually full-bleed chrome), horizontal bands, 8-connected components, merge/contain passes. |
| 13 | Demonstrate the difference visually | **ENHANCED** | Side-by-side panes at true viewport size; the acceptance test asserts the larger device renders strictly more of the page. |
| 14 | Measurement overlay | **ENHANCED** | `DeviceOverlay` adds viewport bounds, safe-area bands with named insets, margin guides and a geometry readout. |
| 15 | Corner radius, gradients, borders | **MISSING** | Diagonal-walk radius estimation, a gradient monotonicity test, edge-density measurement. |
| 16 | Typography geometry without OCR | **MISSING** | `text-detection.ts`: ink profiles, baseline detection, ascender-ratio sizing, 25th-percentile stroke runs for weight. |
| 17 | Never invent what cannot be recreated | **EXISTS→ENHANCED** | Low-confidence regions fall back to a normalized crop of the original bitmap; the font family is reported `UNKNOWN` rather than guessed. |

## 18–24 · Modes and workspace

| § | Requirement | Status | What shipped |
| --- | --- | --- | --- |
| 18 | AI Mode distinct from Dev Mode | **MISSING** | `ReconstructionPanel`: strategy tally, component tally, lowest-confidence reasons. Dev Mode measures; AI Mode explains. |
| 19–20 | Simplify the UI; do not lead with filters | **ENHANCED** | The device explorer shows search and platform only; manufacturer, era, size class and the width/DPR ranges sit behind a "More filters" disclosure that counts the active ones. |
| 21 | Hideable sidebar whose toggle persists | **MISSING** | `SourceSidebar` collapses to a reveal button that stays in the layout. |
| 22 | Zoom snapping | **ENHANCED** | Zoom snaps to 10% steps — 83% and 84% are not comparable. |
| 23 | Render progress | **MISSING** | Four real pipeline stages (analysing, adapting, rendering, validating). No fabricated time estimate. |
| 24 | Neutral A/B selection | **REFACTORED** | Adding a second pane no longer selects it; blank-canvas click or Escape clears the selection. |

## 25–34 · Comparison, overlays, presentation

| § | Requirement | Status | What shipped |
| --- | --- | --- | --- |
| 25 | Device overlay | **MISSING** | See §14. Drawn above the design so it never alters what it measures. |
| 26 | Linked scroll by normalized progress | **REFACTORED** | Was copying raw `scrollTop`. Now syncs progress, so two documents of different heights stay at the same point in the page. |
| 27 | Compare modes | **ENHANCED** | Side-by-side panes labelled A/B/C by position, each at true viewport size. |
| 28 | Difference highlighting | **ENHANCED** | The visual difference is the primary communication: pane sizes, visible-content counts and the overlay. Pixel-diff highlighting remains limited to the server-side comparator, which reports `skipped` with a reason when no capture exists. |
| 29 | Never a blank "Rendering…" | **MISSING** | See §23. |
| 30 | Present mode | **ENHANCED** | Hides the editor chrome and turns off the inspection modes with it. |
| 31 | Source fidelity vs adaptation fidelity | **MISSING** | Two `FidelityScore`s with their own question, confidence, `measurementType` and limitations. Deliberately no combined number. |
| 32–33 | Provenance on everything | **EXISTS** | Plans, reports and exports all carry `sourceId`, `sourceHash`, device id and engine versions. |
| 34 | Constrain reconstruction to the measured tokens | **MISSING** | The Design DNA is what the reconstruction draws from, which is what stops a default font or a rounder radius creeping in. |

## 35–47 · Locking, strategy, honesty

| § | Requirement | Status | What shipped |
| --- | --- | --- | --- |
| 35 | Design DNA lock | **MISSING** | `DesignDna.locked` — the extracted system is the palette the reconstruction may use. |
| 36–37 | Per-region strategy, auditable | **MISSING** | Every classified node carries `analysis` with type, strategy, confidence and human-readable reasons; AI Mode surfaces them. |
| 38–40 | Preserve hierarchy and assets | **EXISTS** | No transform reorders or replaces content. |
| 41 | Export the comparison | **MISSING** | `compare-image` export: one PNG with each pane labelled and measured, provenance naming every device it contains. |
| 42–43 | Keep the original visible | **EXISTS** | The upload is never overwritten and is served as the reference. |
| 44 | Do not blame DPI for a viewport difference | **ENHANCED** | Strategy reasons are phrased in viewport terms; an acceptance assertion checks the explanation. |
| 45–46 | Confidence everywhere | **ENHANCED** | Extended to reconstruction and both fidelity scores. |
| 47 | Blank-canvas click clears selection | **REFACTORED** | See §24. Escape does the same, so it is not pointer-only. |

## 48–57 · Validation, precision, acceptance

| § | Requirement | Status | What shipped |
| --- | --- | --- | --- |
| 48–51 | Two-pass validation, technical corrections only | **EXISTS** | Unchanged. The second pass is mandatory. |
| 52 | Validation gates state what they do not cover | **ENHANCED** | Each fidelity score carries explicit `limitations`; the report's Limitations tab is unchanged. |
| 53 | No false precision | **ENHANCED** | `MeasurementType` — `DETECTED` / `INFERRED` / `DEVICE_DATABASE` / `USER_DEFINED` / `UNKNOWN` — promoted into `@dae/shared` and applied to every reported value. |
| 54 | Do not claim pixel-perfect without measurement | **EXISTS** | Unchanged. |
| 55 | The critical acceptance test | **MISSING** | `e2e/v2-acceptance.spec.ts`, walked in the order the spec states it. Passing. |
| 56 | Do not rebuild from scratch | **EXISTS** | The V1 architecture is intact: five rendering layers, the two-pass validator, the device catalog, the adaptation planner and its transform record are all unchanged in shape. |
| 57 | Priority order | — | Worked in the stated order: viewport behaviour first, then reconstruction, Design DNA, semantic structure, preservation, Dev Mode, comparison, neutral A/B, overlay, simplified UI, progress, validation, export. |

---

## Deliberately not done

- **Reconstruction does not guess safe-area anchors.** The source device is
  unknown, so inventing an anchor would be a fabricated measurement. Validation
  reports the collision instead, which surfaces the uncertainty rather than
  hiding it behind a plausible shift.
- **No AI provider is required.** UI screenshots are flat-shaded and axis-
  aligned, so deterministic computer vision is accurate, offline, testable and
  runs identically in the browser and on the server. The `AIAdapter` port
  remains for optional augmentation.
- **Text is never re-set.** A bitmap cannot tell us its font family, so
  reconstructed text is placed as original pixels. It looks correct and is not
  editable — a stated limitation rather than a substituted default.
