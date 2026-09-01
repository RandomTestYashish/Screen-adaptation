import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Protects the catalog-sync endpoint. The token is compared in constant time
 * and, when unset, the endpoint is closed rather than open - a missing secret
 * must never mean "allow everyone".
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env['ADMIN_API_TOKEN'];
    if (!expected) {
      throw new ForbiddenException('ADMIN_API_TOKEN is not configured, so administrative endpoints are disabled.');
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('x-admin-token') ?? '';
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid administrative token.');
    }
    return true;
  }
}
