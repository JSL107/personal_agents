import { Module } from '@nestjs/common';

import { ModelRouterUsecase } from './application/model-router.usecase';
import { ModelProviderName } from './domain/model-router.type';
import { MODEL_PROVIDER_TOKENS } from './domain/port/model-provider.port';
import { ClaudeCliProvider } from './infrastructure/claude-cli.provider';
import { CodexCliProvider } from './infrastructure/codex-cli.provider';
import { MockModelProvider } from './infrastructure/mock-model.provider';

// ChatGPT / Claude 는 로컬 CLI 구독 어댑터를 바인딩한다 (개인용, API key 불필요).
// Gemini 는 아직 `gemini` CLI 가 설치되어 있지 않아 Mock 으로 유지한다 — 설치 시 GeminiCliProvider 로 교체만 하면 된다.
@Module({
  providers: [
    {
      provide: MODEL_PROVIDER_TOKENS[ModelProviderName.CHATGPT],
      useClass: CodexCliProvider,
    },
    {
      provide: MODEL_PROVIDER_TOKENS[ModelProviderName.CLAUDE],
      useClass: ClaudeCliProvider,
    },
    {
      provide: MODEL_PROVIDER_TOKENS[ModelProviderName.GEMINI],
      useFactory: () => new MockModelProvider(ModelProviderName.GEMINI),
    },
    ModelRouterUsecase,
  ],
  exports: [ModelRouterUsecase],
})
export class ModelRouterModule {}
