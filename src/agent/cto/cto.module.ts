import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { HumanizeModule } from '../../humanize/humanize.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { EvaluateStudyTopicUsecase } from './application/evaluate-study-topic.usecase';

// CTO 자리의 실무는 스터디 주제 판정이다. 배정 기능은 2026-09-04 폐지(실행 0건).
@Module({
  imports: [ModelRouterModule, AgentRunModule, HumanizeModule],
  providers: [EvaluateStudyTopicUsecase],
  exports: [EvaluateStudyTopicUsecase],
})
export class CtoModule {}
