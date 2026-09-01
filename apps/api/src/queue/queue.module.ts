import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { BullJobQueue, InlineJobQueue, JOB_QUEUE } from './job-queue.js';

@Global()
@Module({
  providers: [
    InlineJobQueue,
    BullJobQueue,
    {
      provide: JOB_QUEUE,
      inject: [InlineJobQueue, BullJobQueue],
      useFactory: (inline: InlineJobQueue, bull: BullJobQueue) =>
        loadEnv().QUEUE_DRIVER === 'bullmq' ? bull : inline,
    },
  ],
  exports: [JOB_QUEUE],
})
export class QueueModule {}
