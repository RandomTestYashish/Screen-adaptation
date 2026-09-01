import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderEvidence } from '@dae/shared';
import { api, ApiRequestError } from '../lib/api.js';
import { useWorkspace, type PreviewPane } from '../state/workspace.js';
import type { MeasuredEvidence } from '../renderer/DevicePreview.js';

/**
 * How long to wait for the preview to report real DOM measurements before
 * validating without them. The measurement callback normally fires on the next
 * animation frame; this only covers the case where it never does.
 */
const MEASUREMENT_TIMEOUT_MS = 1500;

/**
 * Renders a pane, then validates it exactly once.
 *
 * Validation waits for the preview to paint and report real DOM measurements,
 * because those upgrade the engine's predictions from `inferred` to `detected`
 * (spec section 14). Validating first without evidence and again with it would
 * double the cost of every device switch for a strictly worse first result, so
 * the wait is bounded instead: if no measurement arrives, validation runs
 * without it and the report says which values are predicted.
 *
 * A device toggle never re-runs the whole pipeline: the plan is cached
 * server-side by source hash + device + versions + options (spec section 24).
 */
export function usePaneRender(pane: PreviewPane) {
  const design = useWorkspace((s) => s.design);
  const updatePane = useWorkspace((s) => s.updatePane);
  const [validating, setValidating] = useState(false);
  const [measured, setMeasured] = useState<MeasuredEvidence>();
  const validatedFor = useRef<string>();

  const optionsKey = `${pane.orientation}|${pane.chrome.keyboard}`;

  useEffect(() => {
    if (!design) return;
    let cancelled = false;

    void (async () => {
      updatePane(pane.id, { status: 'loading', stage: 'analysing', error: undefined, validation: undefined });
      setMeasured(undefined);
      try {
        updatePane(pane.id, { stage: 'adapting' });
        const render = await api.render({
          designDocumentId: design.id,
          deviceId: pane.deviceId,
          options: { orientation: pane.orientation, keyboardVisible: pane.chrome.keyboard },
        });
        if (cancelled) return;
        updatePane(pane.id, { render, status: 'ready', stage: 'rendering' });
      } catch (cause) {
        if (cancelled) return;
        updatePane(pane.id, {
          status: 'error',
          error: describeError(cause),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design?.id, pane.deviceId, optionsKey]);

  const onMeasured = useCallback((evidence: MeasuredEvidence) => {
    setMeasured(evidence);
  }, []);

  // One validation per plan revision, preferring measured evidence.
  useEffect(() => {
    const plan = pane.render?.adaptation.plan;
    if (!plan) return;
    const key = `${plan.id}:${plan.revision}`;
    if (validatedFor.current === key) return;

    let timer: number | undefined;

    const start = () => {
      // Claim the key before awaiting, so a re-render cannot start a second
      // request for the same plan.
      validatedFor.current = key;
      setValidating(true);
      updatePane(pane.id, { stage: 'validating' });

      const evidence: RenderEvidence | undefined = measured
        ? {
            measuredScrollHeight: measured.measuredScrollHeight,
            measuredNodes: measured.measuredNodes,
            availableFonts: measured.availableFonts,
          }
        : undefined;

      api
        .validate(plan.id, evidence)
        .then((outcome) => {
          // A newer plan claimed the slot while this was in flight; its result
          // is authoritative, so drop this one.
          if (validatedFor.current !== key) return;
          updatePane(pane.id, {
            validation: outcome.report,
            // The correction pass may have rewritten the plan; render what the
            // report actually describes.
            render: pane.render ? { ...pane.render, adaptation: outcome.adaptation } : undefined,
          });
        })
        .catch((cause: unknown) => {
          if (validatedFor.current !== key) return;
          // Release the claim so a retry is possible, and leave the render on
          // screen: a failed validation must not blank a correct preview.
          validatedFor.current = undefined;
          updatePane(pane.id, { error: describeError(cause) });
        })
        .finally(() => {
          setValidating(false);
          updatePane(pane.id, { stage: undefined });
        });
    };

    if (measured) start();
    else timer = window.setTimeout(start, MEASUREMENT_TIMEOUT_MS);

    // Only the pending timer is cancelled here. An in-flight request is left to
    // finish and is discarded by the key check above if it has been superseded,
    // so a re-render can never abandon a validation that would otherwise land.
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.render?.adaptation.plan.id, pane.render?.adaptation.plan.revision, measured]);

  return { validating, measured, onMeasured };
}

function describeError(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    if (cause.status === 429) {
      return 'Too many render requests in a short window. Wait a moment and change the device again.';
    }
    return cause.message;
  }
  return (cause as Error).message;
}
