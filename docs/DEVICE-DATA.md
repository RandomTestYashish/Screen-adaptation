# Device data

The product's correctness rests on this data, so it is treated as a first-class
artefact: versioned, validated, attributed per field, and never hand-edited in
the UI.

## The pipeline

```
providers (raw vendor / OEM / community records)
     │  precedence merge — higher precedence wins per device
     ▼
supplemental pass — browser emulation may confirm viewport + DPR only
     │  a disagreement is recorded as a caveat, never applied
     ▼
normalizer — cross-checks, derivations, per-field attribution
     │
     ▼
data/catalog.json — versioned, schema-validated, committed
     │
     ▼
GET /devices — the ONLY thing the UI ever reads
```

The UI never imports a provider module. It reads the normalized schema, which is
what lets the data change without an application change.

## What the normalizer actually checks

- **Logical × DPR against physical resolution.** A mismatch beyond the OS's own
  rounding is reported rather than silently rescaled. This has already caught
  wrong data during development.
- **Safe area against viewport.** Insets that would consume the screen are
  rejected.
- **Cutout against status bar.** A punch-hole whose bottom edge falls below the
  reported status bar would occlude content inside the "safe" area. The
  normalizer raises the top inset to the cutout's bottom edge, marks that field
  `derived` at `medium` confidence, and adds a caveat naming both numbers.

## Units

| Field | Unit |
| --- | --- |
| `viewport`, `safeArea`, `cutout`, `statusBar`, `navigation`, `screenCornerRadius`, `keyboard`, `conventions` | logical (CSS) pixels |
| `physicalResolution`, `ppi` | physical pixels |
| `devicePixelRatio`, `densityBucket` | the conversion factor and its Android bucket |

`physicalPx = logicalPx × devicePixelRatio` is the only sanctioned conversion,
and it lives in one function.

## Confidence

Every field carries `{ source, confidence, reference?, note?, updatedAt }`.

| Level | Meaning |
| --- | --- |
| `high` | Published by the vendor, or directly derived from a published value. |
| `medium` | Documented but genuinely variable (Android insets), or derived by the normalizer. |
| `low` | Not published anywhere; a normalized community measurement. |
| `unknown` | No usable source. |

`overallConfidence` is the **worst** confidence among the geometry-critical
fields, and it caps the preservation score — a `medium`-confidence device cannot
produce a 100/100 result, because the result cannot be verified that precisely.

## Adding a device

1. Add a `RawDeviceRecord` to `packages/device-catalog/src/providers/apple.ts`
   or `android.ts`, with a `sources` entry for every field group.
2. Set `confidence` honestly for anything the vendor does not publish, and add a
   `caveats` line explaining any assumption.
3. Run `pnpm catalog:sync -- --dry` and read the warnings.
4. Run `pnpm catalog:sync` and commit `data/catalog.json`.

`pnpm catalog:verify` fails CI if the committed catalog no longer matches its
providers.

`POST /device-catalog/sync` does the same at runtime, guarded by
`ADMIN_API_TOKEN`. The catalog version is stamped into every adaptation plan and
validation report, so a render can always be traced to the exact data that
produced it.

## Adding a data source

Implement `DeviceDataProvider`:

```ts
export const myProvider: DeviceDataProvider = {
  id: 'my-source',
  name: 'Human-readable name',
  url: 'https://…',
  license: '…',
  precedence: 50,   // higher wins per device
  fetch: async () => [...records],
};
```

Register it in `defaultProviders`. Two rules the merge enforces:

- Higher precedence wins per device; a lower-precedence duplicate is rejected
  and reported.
- A supplemental source may only **confirm** the fields it is allowed to touch.
  If it disagrees with an authoritative source, the authoritative value stands
  and the disagreement becomes a visible caveat.

## What the seed catalog covers

34 profiles: iPhone SE (3rd generation) through the iPhone 17 family; Pixel 5
through Pixel 9 Pro XL; Galaxy S21/S23/S24/S24 Ultra/A54; OnePlus 11; Xiaomi 13;
Nothing Phone (2); Moto G Power.

Logical widths 360, 375, 384, 390, 393, 402, 411, 412, 427, 428, 430, 440, 448.
DPRs 2 through 3.75. Both Android navigation modes, since a 24dp gesture inset
and a 48dp three-button inset change bottom-bar clearance materially.
