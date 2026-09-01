import type { ValidationFinding } from '@dae/shared';
import { finding, measurement, px, type ValidationContext } from '../context.js';
import { round } from '../../layout/geometry.js';
import type { CheckOutput } from './geometry.js';

/**
 * The adaptation is only as trustworthy as the device data behind it, so the
 * profile itself is validated on every run and its confidence is surfaced
 * rather than assumed (spec sections 6 and 32).
 */
export function checkDeviceProfileIntegrity(ctx: ValidationContext): CheckOutput {
  const findings: ValidationFinding[] = [];
  const device = ctx.device;
  const viewport = device.viewport.portrait;
  const safeArea = device.safeArea.portrait;

  const expectedWidth = viewport.width * device.devicePixelRatio;
  const widthDelta = Math.abs(expectedWidth - device.physicalResolution.width);
  if (widthDelta > Math.max(2, device.devicePixelRatio)) {
    findings.push(
      finding({
        check: 'device-profile-integrity',
        severity: 'warning',
        title: 'Logical and physical resolution disagree',
        detail: `${viewport.width} logical px x DPR ${device.devicePixelRatio} is ${round(expectedWidth, 1)} physical px, but the profile records ${device.physicalResolution.width}. One of the two sources is wrong, so density-dependent results should be treated with caution.`,
        confidence: 1,
        measurements: [
          measurement('viewport-width', px(viewport.width), 'detected'),
          measurement('device-pixel-ratio', String(device.devicePixelRatio), 'detected'),
          measurement('physical-width', `${device.physicalResolution.width}px`, 'detected'),
        ],
      }),
    );
  }

  if (safeArea.top + safeArea.bottom >= viewport.height * 0.4) {
    findings.push(
      finding({
        check: 'device-profile-integrity',
        severity: 'warning',
        title: 'Safe-area insets are implausibly large',
        detail: `Top ${px(safeArea.top)} plus bottom ${px(safeArea.bottom)} consumes more than 40% of the ${px(viewport.height)} viewport.`,
        confidence: 0.9,
      }),
    );
  }

  if (device.overallConfidence !== 'high') {
    const lowFields = Object.entries(device.attribution)
      .filter(([, value]) => value.confidence === 'low' || value.confidence === 'unknown')
      .map(([key]) => key);
    findings.push(
      finding({
        check: 'device-profile-integrity',
        severity: 'info',
        title: `${device.marketingName} geometry is ${device.overallConfidence}-confidence`,
        detail: `Some of this device's parameters are not published by the vendor and are carried at reduced confidence${lowFields.length > 0 ? ` (${lowFields.join(', ')})` : ''}. Results on this device are directionally correct but should not be treated as exact.`,
        confidence: 1,
        measurements: [
          measurement('catalog-version', device.catalogVersion, 'detected'),
          measurement('overall-confidence', device.overallConfidence, 'detected'),
        ],
      }),
    );
  }

  for (const caveat of device.caveats) {
    findings.push(
      finding({
        check: 'device-profile-integrity',
        severity: 'info',
        title: 'Device data caveat',
        detail: caveat,
        confidence: 1,
      }),
    );
  }

  if (ctx.adaptation.plan.deviceCatalogVersion !== device.catalogVersion) {
    findings.push(
      finding({
        check: 'device-profile-integrity',
        severity: 'warning',
        title: 'Adaptation was planned against a different catalog version',
        detail: `The plan was built with catalog ${ctx.adaptation.plan.deviceCatalogVersion} but the profile now reports ${device.catalogVersion}. Re-run the adaptation so the geometry matches the current data.`,
        confidence: 1,
      }),
    );
  }

  return { findings, confidence: 1 };
}
