import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { AdaptationResult, DeviceProfile, MetadataRow, ValidationReport } from '@dae/shared';
import { useWorkspace } from '../../state/workspace.js';
import styles from './ValidationPanel.module.css';

interface Props {
  report?: ValidationReport;
  adaptation?: AdaptationResult;
  device?: DeviceProfile;
  busy: boolean;
  onExport(kind: 'validation-report' | 'device-metadata' | 'viewport-image' | 'full-length-image'): void;
}

/**
 * The persistent bottom summary (spec section 14): compact when collapsed,
 * with full render metadata, code-like measurement rows and every finding when
 * expanded.
 */
export function ValidationPanel({ report, adaptation, device, busy, onExport }: Props) {
  const expanded = useWorkspace((s) => s.validationExpanded);
  const setExpanded = useWorkspace((s) => s.setValidationExpanded);

  const status = report?.status ?? (busy ? 'running' : 'not-run');
  const statusLabel =
    status === 'pass'
      ? 'Passed'
      : status === 'pass-with-warnings'
        ? 'Passed with warnings'
        : status === 'fail'
          ? 'Failed'
          : status === 'running'
            ? 'Validating…'
            : 'Not run';

  return (
    <section
      className={expanded ? styles.panelExpanded : styles.panel}
      aria-label="Validation summary"
      data-status={status}
    >
      <button
        type="button"
        className={styles.bar}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="validation-details"
      >
        <span className={styles.barLeft}>
          <span className={styles.chevron} aria-hidden>{expanded ? '▾' : '▸'}</span>
          <span className={styles.device}>{device?.marketingName ?? 'No device'}</span>
          <StatusPill status={status} label={statusLabel} />
        </span>

        <span className={styles.barRight}>
          {adaptation && (
            <Metric
              label="preservation"
              value={`${adaptation.plan.preservation.score}/100`}
              tone={adaptation.plan.preservation.score >= 95 ? 'good' : adaptation.plan.preservation.score >= 80 ? 'neutral' : 'warn'}
            />
          )}
          {report && (
            <>
              <Metric label="critical" value={String(report.criticalCount)} tone={report.criticalCount > 0 ? 'bad' : 'good'} />
              <Metric label="warnings" value={String(report.warningCount)} tone={report.warningCount > 0 ? 'warn' : 'good'} />
              <Metric label="confidence" value={`${Math.round(report.confidence * 100)}%`} tone="neutral" />
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className={styles.details} id="validation-details">
          {!report && !busy && (
            <p className={styles.empty}>Validation runs automatically after each adaptation.</p>
          )}
          {busy && <p className={styles.empty}>Running both validation passes…</p>}
          {report && adaptation && (
            <Details report={report} adaptation={adaptation} onExport={onExport} />
          )}
        </div>
      )}
    </section>
  );
}

function Details({
  report,
  adaptation,
  onExport,
}: {
  report: ValidationReport;
  adaptation: AdaptationResult;
  onExport: Props['onExport'];
}) {
  const [tab, setTab] = useState('findings');
  const finalPass = report.passes[report.passes.length - 1]!;
  const firstPass = report.passes[0]!;

  const findings = useMemo(
    () =>
      finalPass.results
        .flatMap((result) => result.findings)
        .filter((f) => f.severity !== 'pass')
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [finalPass],
  );

  const grouped = useMemo(() => groupMetadata(report.metadata), [report.metadata]);

  return (
    <Tabs.Root value={tab} onValueChange={setTab} className={styles.tabs}>
      <div className={styles.tabsHeader}>
        <Tabs.List className={styles.tabList} aria-label="Validation detail">
          <Tabs.Trigger value="findings" className={styles.tab}>
            Findings ({findings.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="metadata" className={styles.tab}>
            Render metadata
          </Tabs.Trigger>
          <Tabs.Trigger value="transforms" className={styles.tab}>
            Transformations ({adaptation.plan.transforms.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="passes" className={styles.tab}>
            Passes ({report.passes.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="limits" className={styles.tab}>
            Limitations ({report.limitations.length})
          </Tabs.Trigger>
        </Tabs.List>

        <div className={styles.exportGroup}>
          <button type="button" className={styles.exportButton} onClick={() => onExport('viewport-image')}>
            Export viewport
          </button>
          <button type="button" className={styles.exportButton} onClick={() => onExport('full-length-image')}>
            Export full length
          </button>
          <button type="button" className={styles.exportButton} onClick={() => onExport('validation-report')}>
            Export report (JSON)
          </button>
          <button type="button" className={styles.exportButton} onClick={() => onExport('device-metadata')}>
            Export device data
          </button>
        </div>
      </div>

      <Tabs.Content value="findings" className={styles.tabContent}>
        {findings.length === 0 ? (
          <p className={styles.empty}>No warnings or critical issues on this device.</p>
        ) : (
          <ul className={styles.findingList}>
            {findings.map((finding) => (
              <li key={finding.id} className={styles.finding} data-severity={finding.severity}>
                <div className={styles.findingHead}>
                  <span className={styles.severity}>{finding.severity}</span>
                  <span className={styles.findingTitle}>{finding.title}</span>
                  <span className={styles.findingCheck}>{finding.check}</span>
                </div>
                <p className={styles.findingDetail}>{finding.detail}</p>
                {finding.measurements.length > 0 && (
                  <dl className={styles.measurementRows}>
                    {finding.measurements.map((measurement, index) => (
                      <div key={index} className={styles.measurementRow} data-quality={measurement.quality}>
                        <dt>{measurement.label}</dt>
                        <dd>
                          {measurement.value}
                          {measurement.quality !== 'detected' && (
                            <span className={styles.qualityTag}>{measurement.quality}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tabs.Content>

      <Tabs.Content value="metadata" className={styles.tabContent}>
        <div className={styles.metadataColumns}>
          {grouped.map(([group, rows]) => (
            <section key={group} className={styles.metadataGroup}>
              <h4 className={styles.metadataHeading}>{group}</h4>
              <dl className={styles.codeRows}>
                {rows.map((row, index) => (
                  <div key={`${row.key}-${index}`} className={styles.codeRow} data-quality={row.quality}>
                    <dt>{row.key}:</dt>
                    <dd>
                      {row.value}
                      {row.quality !== 'detected' && <span className={styles.qualityTag}>{row.quality}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Tabs.Content>

      <Tabs.Content value="transforms" className={styles.tabContent}>
        <p className={styles.strategyNote}>{adaptation.plan.strategyReason}</p>
        <ul className={styles.transformList}>
          {adaptation.plan.transforms.map((transform) => (
            <li key={transform.id} className={styles.transform} data-impact={transform.impact}>
              <div className={styles.transformHead}>
                <span className={styles.transformType}>{transform.type}</span>
                <span className={styles.transformNode}>{transform.nodeName}</span>
                <span className={styles.transformImpact}>{transform.impact}</span>
                {transform.fromCorrectionPass && <span className={styles.correctionTag}>correction pass</span>}
              </div>
              <p className={styles.transformReason}>{transform.reason}</p>
              <div className={styles.beforeAfter}>
                <code>before {JSON.stringify(transform.before)}</code>
                <code>after {JSON.stringify(transform.after)}</code>
              </div>
            </li>
          ))}
        </ul>
        <section className={styles.preservation}>
          <h4 className={styles.metadataHeading}>Preservation {adaptation.plan.preservation.score}/100</h4>
          <ul className={styles.reasonList}>
            {adaptation.plan.preservation.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </section>
      </Tabs.Content>

      <Tabs.Content value="passes" className={styles.tabContent}>
        {report.passes.map((pass) => (
          <section key={pass.pass} className={styles.pass}>
            <h4 className={styles.metadataHeading}>
              Pass {pass.pass} · plan revision {pass.planRevision} · {pass.durationMs.toFixed(1)}ms
            </h4>
            {pass.correctionsApplied.length > 0 && (
              <div className={styles.corrections}>
                <p className={styles.correctionsTitle}>Corrections applied before the next pass:</p>
                <ul>
                  {pass.correctionsApplied.map((correction, index) => (
                    <li key={index}>{correction}</li>
                  ))}
                </ul>
              </div>
            )}
            <table className={styles.checkTable}>
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Result</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {pass.results.map((result) => (
                  <tr key={result.check} data-status={result.status}>
                    <th scope="row">{result.check}</th>
                    <td>
                      <span className={styles.checkStatus}>{result.status}</span>
                    </td>
                    <td>{result.status === 'skipped' ? '—' : `${Math.round(result.confidence * 100)}%`}</td>
                    <td className={styles.checkNote}>
                      {result.skippedReason ??
                        (result.findings.length > 0
                          ? `${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`
                          : 'No issues')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {firstPass.correctionsApplied.length === 0 && (
          <p className={styles.note}>
            The first pass found nothing to correct, so the second pass re-verified the same result. Both passes
            always run.
          </p>
        )}
      </Tabs.Content>

      <Tabs.Content value="limits" className={styles.tabContent}>
        <p className={styles.note}>
          What this run could not verify. These are stated rather than hidden, so a clean report is never mistaken
          for a guarantee.
        </p>
        <ul className={styles.limitList}>
          {report.limitations.map((limitation, index) => (
            <li key={index}>{limitation}</li>
          ))}
        </ul>
      </Tabs.Content>
    </Tabs.Root>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span className={styles.statusPill} data-status={status}>
      {label}
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <span className={styles.metric} data-tone={tone}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </span>
  );
}

function severityRank(severity: string): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}

function groupMetadata(rows: MetadataRow[]): [string, MetadataRow[]][] {
  const order = ['viewport', 'device', 'safe-area', 'content', 'scroll', 'typography', 'spacing', 'source'];
  const map = new Map<string, MetadataRow[]>();
  for (const row of rows) {
    const list = map.get(row.group) ?? [];
    list.push(row);
    map.set(row.group, list);
  }
  return order.filter((group) => map.has(group)).map((group) => [group, map.get(group)!]);
}
