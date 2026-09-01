import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { loadEnv } from '../config/env.js';

export type JobHandler<T> = (payload: T) => Promise<unknown>;

export interface JobQueue {
  readonly driver: 'inline' | 'bullmq';
  register<T>(name: string, handler: JobHandler<T>): void;
  enqueue<T>(name: string, payload: T): Promise<{ jobId: string; ranInline: boolean }>;
}

export const JOB_QUEUE = 'JOB_QUEUE';

/**
 * Runs jobs in-process. This is the default so the product works with no Redis,
 * behind the same interface the BullMQ driver implements - callers never learn
 * which one is active.
 */
@Injectable()
export class InlineJobQueue implements JobQueue {
  readonly driver = 'inline' as const;
  private readonly logger = new Logger(InlineJobQueue.name);
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private counter = 0;

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<unknown>);
  }

  async enqueue<T>(name: string, payload: T): Promise<{ jobId: string; ranInline: boolean }> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler registered for job "${name}"`);
    const jobId = `inline-${++this.counter}`;
    const started = performance.now();
    await handler(payload);
    this.logger.debug(`Ran ${name} inline in ${Math.round(performance.now() - started)}ms`);
    return { jobId, ranInline: true };
  }
}

/**
 * BullMQ-backed queue for expensive analysis, render and validation work
 * (spec section 17). Enabled with QUEUE_DRIVER=bullmq and a REDIS_URL.
 */
@Injectable()
export class BullJobQueue implements JobQueue, OnApplicationShutdown {
  readonly driver = 'bullmq' as const;
  private readonly logger = new Logger(BullJobQueue.name);
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private queues = new Map<string, { add: (name: string, data: unknown) => Promise<{ id?: string }>; close: () => Promise<void> }>();
  private workers: { close: () => Promise<void> }[] = [];

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<unknown>);
    void this.startWorker(name);
  }

  private async startWorker(name: string): Promise<void> {
    const { Worker } = await import('bullmq');
    const connection = { url: loadEnv().REDIS_URL! };
    const worker = new Worker(
      name,
      async (job) => {
        const handler = this.handlers.get(name);
        if (!handler) throw new Error(`No handler registered for job "${name}"`);
        return handler(job.data);
      },
      { connection: connection as never },
    );
    worker.on('failed', (job, error) => this.logger.error(`Job ${name}#${job?.id} failed: ${error.message}`));
    this.workers.push(worker);
  }

  async enqueue<T>(name: string, payload: T): Promise<{ jobId: string; ranInline: boolean }> {
    const { Queue } = await import('bullmq');
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: { url: loadEnv().REDIS_URL! } as never }) as never;
      this.queues.set(name, queue!);
    }
    const job = await queue!.add(name, payload);
    return { jobId: job.id ?? 'unknown', ranInline: false };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.workers.map((w) => w.close()), ...[...this.queues.values()].map((q) => q.close())]);
  }
}
