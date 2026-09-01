import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CatalogSyncRequest, CatalogSyncResponse, DeviceListResponse, DeviceProfileSchema, DeviceQuery } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';
import { AdminGuard } from '../common/admin.guard.js';
import { DevicesService } from './devices.service.js';

@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('devices')
  list(@Query() query: unknown) {
    const parsed = parseOrThrow(DeviceQuery, query, 'device query');
    return DeviceListResponse.parse(this.devices.query(parsed));
  }

  @Get('devices/:id')
  get(@Param('id') id: string) {
    return DeviceProfileSchema.parse(this.devices.get(id));
  }

  @Post('device-catalog/sync')
  @UseGuards(AdminGuard)
  async sync(@Body() body: unknown) {
    const parsed = parseOrThrow(CatalogSyncRequest, body ?? {}, 'catalog sync request');
    const result = await this.devices.sync({ dryRun: parsed.dryRun });
    return CatalogSyncResponse.parse(result);
  }
}
