import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

/**
 * Validate a request payload against the shared contract. Using the same Zod
 * schema on both sides is what keeps client and server models from drifting
 * (spec section 21).
 */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'ValidationError',
        message: `Invalid ${what}`,
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return result.data;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(
        typeof body === 'string'
          ? { statusCode: status, error: exception.name, message: body }
          : { statusCode: status, ...(body as object) },
      );
      return;
    }

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'ValidationError',
        message: 'Response failed contract validation',
        details: exception.issues,
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : 'Unknown error';
    this.logger.error(message, exception instanceof Error ? exception.stack : undefined);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      // Never leak internals to the client.
      message: 'The request could not be completed.',
    });
  }
}
