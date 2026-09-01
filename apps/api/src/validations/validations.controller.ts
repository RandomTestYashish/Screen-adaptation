import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ValidationReportSchema, ValidationRunRequest, ValidationRunResponse } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';
import { ValidationService } from './validation.service.js';
import { loadEnv } from '../config/env.js';

@Controller('validations')
export class ValidationsController {
  constructor(private readonly validations: ValidationService) {}

  @Post('run')
  @Throttle({ expensive: { limit: loadEnv().RATE_LIMIT_EXPENSIVE_LIMIT, ttl: loadEnv().RATE_LIMIT_TTL_SECONDS * 1000 } })
  async run(@Body() body: unknown) {
    const parsed = parseOrThrow(ValidationRunRequest, body, 'validation request');
    const outcome = await this.validations.run(parsed);
    return ValidationRunResponse.parse(outcome);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ValidationReportSchema.parse(await this.validations.get(id));
  }
}
