import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ValidationReportSchema, ValidationRunRequest, ValidationRunResponse } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';
import { type ValidationService } from './validation.service.js';

@Controller('validations')
export class ValidationsController {
  constructor(private readonly validations: ValidationService) {}

  @Post('run')
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
