import { Module } from '@nestjs/common';

import { NotificationQueueModule } from '../notification/notification-queue.module';
import { ModelRouterUsecase } from './application/model-router.usecase';
import { ModelProviderName } from './domain/model-router.type';
import { MODEL_PROVIDER_TOKENS } from './domain/port/model-provider.port';
import { ClaudeCliProvider } from './infrastructure/claude-cli.provider';
import { CodexCliProvider } from './infrastructure/codex-cli.provider';

// CHATGPT(codex) 를 전체 provider 로 사용. Claude 어댑터는 롤백 대비 DI 에 등록만 유지(라우팅 경로 없음).
// provider 간 fallback 없음 — ModelRouterUsecase.route() 가 primary 실패 시 즉시 전파(2026-07-02).
// (Gemini 제거 2026-06-04, Claude 라우팅 제거 2026-07-02.)
//
// provider 토큰은 module 밖으로 export 하지 않는다 — 모든 LLM 호출은 ModelRouterUsecase.route() 를
// 거쳐 fallback chain 을 타야 하므로, 외부 consumer 가 단일 provider 를 직접 주입하는 우회를 막는다.
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
  exports: [ModelRouterUsecase],
})
export class ModelRouterModule {}
