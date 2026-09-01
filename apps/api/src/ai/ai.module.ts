import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { AI_ADAPTER, NullAIAdapter, OpenAIAdapter } from './ai-adapter.js';

@Global()
@Module({
  providers: [
    NullAIAdapter,
    OpenAIAdapter,
    {
      provide: AI_ADAPTER,
      inject: [NullAIAdapter, OpenAIAdapter],
      useFactory: (nullAdapter: NullAIAdapter, openai: OpenAIAdapter) =>
        loadEnv().AI_PROVIDER === 'openai' ? openai : nullAdapter,
    },
  ],
  exports: [AI_ADAPTER],
})
export class AiModule {}
