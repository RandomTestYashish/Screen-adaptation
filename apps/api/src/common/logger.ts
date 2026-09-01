import { Injectable, type LoggerService } from '@nestjs/common';
import { loadEnv } from '../config/env.js';

const LEVELS = { debug: 10, log: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/**
 * Structured JSON logging. Fields line up with OpenTelemetry resource
 * attributes so a collector can ingest them without a transform
 * (spec section 17).
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly threshold = LEVELS[loadEnv().LOG_LEVEL];
  private readonly service = loadEnv().OTEL_SERVICE_NAME;

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      'service.name': this.service,
      context: context ?? 'app',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...extra,
    });
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  log(message: unknown, context?: string) { this.write('log', message, context); }
  error(message: unknown, stack?: string, context?: string) { this.write('error', message, context, stack ? { stack } : {}); }
  warn(message: unknown, context?: string) { this.write('warn', message, context); }
  debug(message: unknown, context?: string) { this.write('debug', message, context); }
  verbose(message: unknown, context?: string) { this.write('debug', message, context); }

  /** Emit a timed operation, the unit an OTel span would carry. */
  operation(name: string, durationMs: number, attributes: Record<string, unknown> = {}): void {
    this.write('log', name, 'operation', { 'duration.ms': durationMs, ...attributes });
  }
}
