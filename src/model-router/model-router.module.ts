import { Module } from '@nestjs/common';

import { NotificationQueueModule } from '../notification/notification-queue.module';
import { ModelRouterUsecase } from './application/model-router.usecase';
import { ModelProviderName } from './domain/model-router.type';
import { MODEL_PROVIDER_TOKENS } from './domain/port/model-provider.port';
import { ClaudeCliProvider } from './infrastructure/claude-cli.provider';
import { CodexCliProvider } from './infrastructure/codex-cli.provider';

// 두 모델 모두 로컬 CLI 구독 어댑터로 바인딩 (개인용, API key 비용 회피).
// 실패 fallback chain 은 ModelRouterUsecase 에서 수행 — CLAUDE primary 실패 시 CHATGPT 로 자동 재시도.
// (Gemini provider 는 사용자 미구독 정책으로 제거 — 2026-06-04.)
//
// CHATGPT / CLAUDE provider 토큰을 module 밖으로 export — RouterModule 의 ConversationalReplyUsecase
// 같은 외부 consumer 가 직접 CHATGPT 만 호출하는 경우를 지원하기 위함.
@Module({
  imports: [NotificationQueueModule],
  providers: [
    {
      provide: MODEL_PROVIDER_TOKENS[ModelProviderName.CHATGPT],
      useClass: CodexCliProvider,
    },
    {
      provide: MODEL_PROVIDER_TOKENS[ModelProviderName.CLAUDE],
      useClass: ClaudeCliProvider,
    },
    ModelRouterUsecase,
  ],
  exports: [
    ModelRouterUsecase,
    MODEL_PROVIDER_TOKENS[ModelProviderName.CHATGPT],
    MODEL_PROVIDER_TOKENS[ModelProviderName.CLAUDE],
  ],
})
export class ModelRouterModule {}
