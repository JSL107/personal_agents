import { Module } from '@nestjs/common';

import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { ReviewReplyJudgeModule } from '../agent/review-reply-judge/review-reply-judge.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { EpisodicMemoryModule } from '../episodic-memory/episodic-memory.module';
import { GithubModule } from '../github/github.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HarvestReviewSignalsUsecase } from './application/harvest-review-signals.usecase';
import { SweepPrReviewsUsecase } from './application/sweep-pr-reviews.usecase';
import { PrReviewPublishModule } from './pr-review-publish.module';

// PR 리뷰 루프 Phase 1 — 스윕 오케스트레이션 · 카드 영속화 · 게시 전담.
// 리뷰 생성(LLM)은 CodeReviewerModule 의 ReviewPullRequestUsecase 를 그대로 쓴다.
// AgentRunModule 은 "PR 당 리뷰 1회" 판정(AgentRunService.hasSweepReviewFor) 때문에 필요하다.
@Module({
  imports: [
    PrismaModule,
    GithubModule,
    CodeReviewerModule,
    AgentRunModule,
    ReviewReplyJudgeModule,
    EpisodicMemoryModule,
    PrReviewPublishModule,
  ],
  providers: [SweepPrReviewsUsecase, HarvestReviewSignalsUsecase],
  exports: [SweepPrReviewsUsecase, HarvestReviewSignalsUsecase],
})
export class PrReviewLoopModule {}
