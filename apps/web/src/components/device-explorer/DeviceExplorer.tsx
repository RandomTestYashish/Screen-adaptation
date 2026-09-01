import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import type { DeviceProfile } from '@dae/shared';
import { api } from '../../lib/api.js';
import { useWorkspace } from '../../state/workspace.js';
import styles from './DeviceExplorer.module.css';

type SizeCategory = '' | 'compact' | 'regular' | 'large';

interface Filters {
  search: string;
  platform: '' | 'ios' | 'android';
  manufacturer: string;
  era: string;
  sizeCategory: SizeCategory;
  minWidth: string;
  maxWidth: string;
  minDpr: string;
  maxDpr: string;
}

const EMPTY: Filters = {
  search: '',
  platform: '',
  manufacturer: '',
  era: '',
  sizeCategory: '',
  minWidth: '',
  maxWidth: '',
  minDpr: '',
  maxDpr: '',
};

/**
 * A working device explorer, not a static list (spec section 11). Selecting a
 * device updates the preview immediately, and no device parameter is ever
 * entered by hand.
 */
export function DeviceExplorer() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [detailsFor, setDetailsFor] = useState<DeviceProfile>();
  const panes = useWorkspace((s) => s.panes);
  const pickingForPaneId = useWorkspace((s) => s.pickingForPaneId);
  const activePaneId = useWorkspace((s) => s.activePaneId);
  const setPaneDevice = useWorkspace((s) => s.setPaneDevice);
  const addPane = useWorkspace((s) => s.addPane);
  const favourites = useWorkspace((s) => s.favourites);
  const recents = useWorkspace((s) => s.recents);
  const toggleFavourite = useWorkspace((s) => s.toggleFavourite);

  const query = useMemo(
    () => ({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.platform ? { platform: filters.platform } : {}),
      ...(filters.manufacturer ? { manufacturer: filters.manufacturer } : {}),
      ...(filters.era ? { era: filters.era } : {}),
      ...(filters.sizeCategory ? { sizeCategory: filters.sizeCategory } : {}),
      ...(filters.minWidth ? { minWidth: Number(filters.minWidth) } : {}),
      ...(filters.maxWidth ? { maxWidth: Number(filters.maxWidth) } : {}),
      ...(filters.minDpr ? { minDpr: Number(filters.minDpr) } : {}),
      ...(filters.maxDpr ? { maxDpr: Number(filters.maxDpr) } : {}),
    }),
    [filters],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['devices', query],
    queryFn: () => api.listDevices(query),
    staleTime: 5 * 60 * 1000,
  });

  const selectedIds = new Set(panes.map((p) => p.deviceId));
  const targetPaneId = pickingForPaneId ?? activePaneId;

  const choose = (device: DeviceProfile) => {
    if (pickingForPaneId) setPaneDevice(pickingForPaneId, device.id);
    else if (targetPaneId) setPaneDevice(targetPaneId, device.id);
    else addPane(device.id);
  };

  const byId = useMemo(() => new Map((data?.devices ?? []).map((d) => [d.id, d])), [data]);
  const quickPicks = [
    ...favourites.map((id) => byId.get(id)).filter((d): d is DeviceProfile => Boolean(d)),
    ...recents
      .map((id) => byId.get(id))
      .filter((d): d is DeviceProfile => Boolean(d))
      .filter((d) => !favourites.includes(d.id)),
  ].slice(0, 6);

  return (
    <aside className={styles.panel} aria-label="Device explorer">
      <header className={styles.header}>
        <h2 className={styles.heading}>
          Devices
          {data && <span className={styles.count}>{data.total} of {data.devices.length >= data.total ? data.total : data.total}</span>}
        </h2>
        {pickingForPaneId && <p className={styles.pickingHint}>Choosing a device for the new preview…</p>}
      </header>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by name, model or manufacturer"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          aria-label="Search devices"
        />

        <div className={styles.segmented} role="group" aria-label="Platform">
          {(['', 'ios', 'android'] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              className={filters.platform === value ? styles.segmentActive : styles.segment}
              onClick={() => setFilters({ ...filters, platform: value })}
              aria-pressed={filters.platform === value}
            >
              {value === '' ? 'All' : value === 'ios' ? 'Apple' : 'Android'}
            </button>
          ))}
        </div>

        <div className={styles.filterRow}>
          <label className={styles.selectField}>
            <span>Manufacturer</span>
            <select
              value={filters.manufacturer}
              onChange={(e) => setFilters({ ...filters, manufacturer: e.target.value })}
            >
              <option value="">Any</option>
              {(data?.facets.manufacturers ?? []).map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.value} ({facet.count})
                </option>
              ))}
            </select>
          </label>

          <label className={styles.selectField}>
            <span>Era</span>
            <select value={filters.era} onChange={(e) => setFilters({ ...filters, era: e.target.value })}>
              <option value="">Any</option>
              {(data?.facets.eras ?? []).map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.value} ({facet.count})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.filterRow}>
          <label className={styles.selectField}>
            <span>Size class</span>
            <select
              value={filters.sizeCategory}
              onChange={(e) => setFilters({ ...filters, sizeCategory: e.target.value as SizeCategory })}
            >
              <option value="">Any</option>
              <option value="compact">Compact (≤375px)</option>
              <option value="regular">Regular (376–412px)</option>
              <option value="large">Large (&gt;412px)</option>
            </select>
          </label>
        </div>

        <div className={styles.rangeRow}>
        <fieldset className={styles.rangeGroup}>
          <legend>Logical width</legend>
          <input
            type="number"
            placeholder={String(data?.facets.widthRange.min ?? 320)}
            value={filters.minWidth}
            onChange={(e) => setFilters({ ...filters, minWidth: e.target.value })}
            aria-label="Minimum logical width"
          />
          <span aria-hidden>–</span>
          <input
            type="number"
            placeholder={String(data?.facets.widthRange.max ?? 480)}
            value={filters.maxWidth}
            onChange={(e) => setFilters({ ...filters, maxWidth: e.target.value })}
            aria-label="Maximum logical width"
          />
        </fieldset>

        <fieldset className={styles.rangeGroup}>
          <legend>Pixel ratio</legend>
          <input
            type="number"
            step="0.125"
            placeholder={String(data?.facets.dprRange.min ?? 2)}
            value={filters.minDpr}
            onChange={(e) => setFilters({ ...filters, minDpr: e.target.value })}
            aria-label="Minimum device pixel ratio"
          />
          <span aria-hidden>–</span>
          <input
            type="number"
            step="0.125"
            placeholder={String(data?.facets.dprRange.max ?? 4)}
            value={filters.maxDpr}
            onChange={(e) => setFilters({ ...filters, maxDpr: e.target.value })}
            aria-label="Maximum device pixel ratio"
          />
        </fieldset>
        </div>

        <button type="button" className={styles.clear} onClick={() => setFilters(EMPTY)}>
          Clear filters
        </button>
      </div>

      {quickPicks.length > 0 && (
        <section className={styles.quickSection}>
          <h3 className={styles.sectionTitle}>Favourites & recent</h3>
          <div className={styles.chips}>
            {quickPicks.map((device) => (
              <button key={device.id} type="button" className={styles.chip} onClick={() => choose(device)}>
                {favourites.includes(device.id) ? '★ ' : ''}
                {device.marketingName}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className={styles.list} role="list">
        {isLoading && <p className={styles.state}>Loading device catalog…</p>}
        {error && <p className={styles.state}>The device catalog could not be loaded.</p>}
        {data?.devices.length === 0 && <p className={styles.state}>No devices match these filters.</p>}

        {(data?.devices ?? []).map((device) => (
          <div key={device.id} role="listitem" className={selectedIds.has(device.id) ? styles.rowSelected : styles.row}>
            <button type="button" className={styles.rowMain} onClick={() => choose(device)}>
              <span className={styles.rowName}>{device.marketingName}</span>
              <span className={styles.rowMeta}>
                {device.viewport.portrait.width}x{device.viewport.portrait.height} · DPR{' '}
                {device.devicePixelRatio} · {device.osName}
              </span>
              <span className={styles.rowMeta}>
                safe {device.safeArea.portrait.top}/{device.safeArea.portrait.bottom} ·{' '}
                {device.cutout.kind === 'none' ? 'no cutout' : device.cutout.kind.replace('-', ' ')}
                {device.overallConfidence !== 'high' && (
                  <span className={styles.confidenceBadge} title="Some parameters are not vendor-published">
                    {device.overallConfidence} confidence
                  </span>
                )}
              </span>
            </button>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => toggleFavourite(device.id)}
                aria-label={favourites.includes(device.id) ? `Unfavourite ${device.marketingName}` : `Favourite ${device.marketingName}`}
                aria-pressed={favourites.includes(device.id)}
              >
                {favourites.includes(device.id) ? '★' : '☆'}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setDetailsFor(device)}
                aria-label={`Details for ${device.marketingName}`}
              >
                ⓘ
              </button>
            </div>
          </div>
        ))}
      </div>

      <DeviceDetails device={detailsFor} onClose={() => setDetailsFor(undefined)} />
    </aside>
  );
}

/** Full profile with per-field source attribution, so nothing is unexplained. */
function DeviceDetails({ device, onClose }: { device?: DeviceProfile; onClose(): void }) {
  return (
    <Dialog.Root open={Boolean(device)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialog}>
          {device && (
            <>
              <Dialog.Title className={styles.dialogTitle}>{device.marketingName}</Dialog.Title>
              <Dialog.Description className={styles.dialogDescription}>
                {device.manufacturer} · {device.osName} {device.osVersionRange.min}+ · released {device.releaseYear}
                {device.screenSizeInches ? ` · ${device.screenSizeInches}"` : ''}
              </Dialog.Description>

              <dl className={styles.detailGrid}>
                <Detail label="logical-viewport" value={`${device.viewport.portrait.width} x ${device.viewport.portrait.height} px`} />
                <Detail label="physical-resolution" value={`${device.physicalResolution.width} x ${device.physicalResolution.height} px`} />
                <Detail label="device-pixel-ratio" value={String(device.devicePixelRatio)} />
                <Detail label="density-bucket" value={device.densityBucket ?? 'n/a (iOS)'} />
                <Detail label="ppi" value={device.ppi ? String(device.ppi) : 'unavailable'} />
                <Detail label="aspect-ratio" value={device.aspectRatio.toFixed(3)} />
                <Detail label="safe-area" value={`${device.safeArea.portrait.top} / ${device.safeArea.portrait.right} / ${device.safeArea.portrait.bottom} / ${device.safeArea.portrait.left} px`} />
                <Detail label="status-bar-height" value={`${device.statusBar.height} px`} />
                <Detail label="cutout" value={device.cutout.kind === 'none' ? 'none' : `${device.cutout.kind} ${device.cutout.width} x ${device.cutout.height} px at y=${device.cutout.top}`} />
                <Detail label="navigation" value={`${device.navigation.mode} (${device.navigation.height} px)`} />
                <Detail label="screen-corner-radius" value={`${device.screenCornerRadius} px`} />
                <Detail label="keyboard-height" value={device.keyboard.supported ? `${device.keyboard.height} px + ${device.keyboard.accessoryHeight} px accessory` : 'n/a'} />
                <Detail label="min-touch-target" value={`${device.conventions.minTouchTarget} px`} />
                <Detail label="system-font" value={device.conventions.systemFont} />
                <Detail label="catalog-version" value={device.catalogVersion} />
                <Detail label="overall-confidence" value={device.overallConfidence} />
              </dl>

              <h3 className={styles.detailHeading}>Where each value comes from</h3>
              <ul className={styles.attributionList}>
                {Object.entries(device.attribution).map(([path, entry]) => (
                  <li key={path}>
                    <code>{path}</code>
                    <span className={styles.attributionSource}>
                      {entry.source} · {entry.confidence}
                    </span>
                    {entry.note && <span className={styles.attributionNote}>{entry.note}</span>}
                  </li>
                ))}
              </ul>

              {device.caveats.length > 0 && (
                <>
                  <h3 className={styles.detailHeading}>Caveats</h3>
                  <ul className={styles.caveatList}>
                    {device.caveats.map((caveat, index) => (
                      <li key={index}>{caveat}</li>
                    ))}
                  </ul>
                </>
              )}

              <Dialog.Close className={styles.dialogClose} aria-label="Close">
                Close
              </Dialog.Close>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
