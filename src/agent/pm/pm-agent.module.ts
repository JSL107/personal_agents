import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { DailyPlanModule } from '../../daily-plan/daily-plan.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { NotionModule } from '../../notion/notion.module';
import { PreferenceProfileModule } from '../../preference-profile/preference-profile.module';
import { SlackCollectorModule } from '../../slack-collector/slack-collector.module';
import { SlackInboxModule } from '../../slack-inbox/slack-inbox.module';
import { DailyPlanContextCollector } from './application/daily-plan-context.collector';
import { DailyPlanEvidenceBuilder } from './application/daily-plan-evidence.builder';
import { DailyPlanPromptBuilder } from './application/daily-plan-prompt.builder';
import { GenerateDailyPlanUsecase } from './application/generate-daily-plan.usecase';
import { SyncContextUsecase } from './application/sync-context.usecase';
import { SyncPlanUsecase } from './application/sync-plan.usecase';
import { PmDispatcher } from './infrastructure/pm.dispatcher';

// PreviewGateModule (global) 가 CreatePreviewUsecase 를 자동 노출 — SyncPlanUsecase 가 그걸 inject.
// PmDispatcher 는 AGENT_DISPATCHER_PORT multi-provider 로 등록 — RouterModule 의 IdaeriRouterUsecase 가
// dispatchers array 로 inject 받아 agentType=PM 매핑을 자동 인식.
@Module({
  imports: [
    ModelRouterModule,
    AgentRunModule,
    DailyPlanModule,
    GithubModule,
    NotionModule,
    // 학습된 업무 선호(priorities 등)를 데일리플랜 생성에 주입 — PREFERENCE_PROFILE_PORT export.
    PreferenceProfileModule,
    SlackCollectorModule,
    // OPS-3 Slack Reaction → Inbox
    SlackInboxModule,
  ],
  providers: [
    GenerateDailyPlanUsecase,
    SyncContextUsecase,
    SyncPlanUsecase,
    DailyPlanContextCollector,
    DailyPlanPromptBuilder,
    DailyPlanEvidenceBuilder,
    PmDispatcher,
  ],
  exports: [
    GenerateDailyPlanUsecase,
    SyncContextUsecase,
    SyncPlanUsecase,
    PmDispatcher,
  ],
})
export class PmAgentModule {}
