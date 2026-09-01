/**
 * Background worker.
 *
 * Runs the scheduled device-catalog ingestion (spec section 6: "Add a scheduled
 * ingestion/update mechanism so new devices can be added without changing
 * application code").
 *
 *   pnpm dev:worker                       # run on a schedule
 *   pnpm --filter @dae/worker sync-once   # run once and exit
 *
 * Expensive render and validation jobs are enqueued through the API's JobQueue
 * port. With QUEUE_DRIVER=inline (the default) they run in the API process and
 * this worker is not needed; with QUEUE_DRIVER=bullmq they are consumed here.
 */
import { runCatalogSync } from './catalog-sync.job.js';

const ONCE = process.argv.includes('--once');
const INTERVAL_HOURS = Number(process.env['CATALOG_SYNC_INTERVAL_HOURS'] ?? 24);
const DRY_RUN = process.argv.includes('--dry');

function log(message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'log', 'service.name': 'dae-worker', message, ...extra })}\n`,
  );
}

async function sync(): Promise<void> {
  const started = Date.now();
  try {
    const outcome = await runCatalogSync({ dryRun: DRY_RUN });
    log('catalog.sync', {
      'duration.ms': Date.now() - started,
      catalogVersion: outcome.catalogVersion,
      devices: outcome.deviceCount,
      added: outcome.added.length,
      updated: outcome.updated.length,
      rejected: outcome.rejected.length,
      warnings: outcome.warnings.length,
      changed: outcome.changed,
      wrote: outcome.wrote,
    });
    for (const warning of outcome.warnings) log('catalog.sync.warning', { detail: warning });
    for (const rejection of outcome.rejected) log('catalog.sync.rejected', { ...rejection });
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', 'service.name': 'dae-worker', message: 'catalog.sync failed', error: (error as Error).message })}\n`,
    );
    if (ONCE) process.exitCode = 1;
  }
}

await sync();

if (!ONCE) {
  log('worker.started', { intervalHours: INTERVAL_HOURS });
  const timer = setInterval(() => void sync(), INTERVAL_HOURS * 60 * 60 * 1000);
  const stop = () => {
    clearInterval(timer);
    log('worker.stopped');
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
