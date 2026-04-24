import { Module } from '@nestjs/common';

import { ModelRouterUsecase } from './application/model-router.usecase';
import { ModelProviderName } from './domain/model-router.type';
import { MODEL_PROVIDER_TOKENS } from './domain/port/model-provider.port';
import { ClaudeCliProvider } from './infrastructure/claude-cli.provider';
import { CodexCliProvider } from './infrastructure/codex-cli.provider';
import { GeminiCliProvider } from './infrastructure/gemini-cli.provider';

// 세 모델 모두 로컬 CLI 구독/무료 tier 어댑터로 바인딩 (개인용, API key 비용 회피).
// Gemini 는 OAuth (gemini 인터랙티브 1회 로그인) 또는 GEMINI_API_KEY 설정 필요.
// 실패 fallback chain 은 ModelRouterUsecase 에서 수행 — primary 실패 시 Gemini 로 자동 재시도.
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
      useClass: GeminiCliProvider,
    },
    ModelRouterUsecase,
  ],
  exports: [ModelRouterUsecase],
})
export class ModelRouterModule {}
