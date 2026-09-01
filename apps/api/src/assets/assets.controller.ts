import { Controller, Get, Header, HttpException, HttpStatus, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loadEnv } from '../config/env.js';
import type { Response } from 'express';
import { LocalAssetStore } from './asset-store.js';

/**
 * Serves stored assets only when the request carries a valid, unexpired
 * signature. Uploaded designs are private by default.
 */
@Controller('assets')
export class AssetsController {
  constructor(private readonly store: LocalAssetStore) {}

  @Get(':id')
  // Access control here is the signature, not a budget: a workspace comparing
  // several devices legitimately issues many asset reads.
  @Throttle({ assets: { limit: loadEnv().RATE_LIMIT_ASSET_LIMIT, ttl: loadEnv().RATE_LIMIT_TTL_SECONDS * 1000 } })
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  // The web app draws these into a canvas to produce image exports, which
  // requires a CORS-clean response.
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Timing-Allow-Origin', '*')
  async serve(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!expires || !signature || !this.store.verify(id, expires, signature)) {
      throw new HttpException(
        { statusCode: HttpStatus.FORBIDDEN, error: 'Forbidden', message: 'Invalid or expired asset URL' },
        HttpStatus.FORBIDDEN,
      );
    }
    const data = await this.store.get(id);
    if (!data) {
      throw new HttpException(
        { statusCode: HttpStatus.NOT_FOUND, error: 'NotFound', message: 'Asset not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    response.setHeader('Content-Type', await this.store.mimeType(id));
    response.setHeader('Content-Length', data.byteLength);
    response.end(data);
  }
}
