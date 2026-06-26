import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { GithubModule } from '../github/github.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { NotionModule } from '../notion/notion.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RouterModule } from '../router/router.module';
import { SlackModule } from '../slack/slack.module';
import { SlackInboxModule } from '../slack-inbox/slack-inbox.module';
import { SubconsciousEngine } from './application/subconscious.engine';
import { SubconsciousScheduler } from './application/subconscious.scheduler';
import { SubconsciousProposalService } from './application/subconscious-proposal.service';
import { SubconsciousTickProcessor } from './application/subconscious-tick.processor';
import { PROMOTION_BUDGET } from './domain/port/promotion-budget.port';
import { PROPOSAL_EMITTER } from './domain/port/proposal-emitter.port';
import type { StateSource } from './domain/port/state-source.port';
import { STATE_SOURCES } from './domain/port/state-source.port';
import { SUBCONSCIOUS_BASELINE_REPOSITORY } from './domain/port/subconscious-baseline.repository.port';
import { SUBCONSCIOUS_GATE } from './domain/port/subconscious-gate.port';
import { SUBCONSCIOUS_PROPOSAL_REPOSITORY } from './domain/port/subconscious-proposal.repository.port';
import { SUBCONSCIOUS_TICK_QUEUE } from './domain/subconscious-tick.type';
import { GithubStateSource } from './infrastructure/github-state-source';
import { LlmSubconsciousGate } from './infrastructure/llm-subconscious-gate';
import { NotionStateSource } from './infrastructure/notion-state-source';
import { RedisPromotionBudget } from './infrastructure/redis-promotion-budget';
import { SlackInboxStateSource } from './infrastructure/slack-inbox-state-source';
import { SubconsciousBaselinePrismaRepository } from './infrastructure/subconscious-baseline.prisma.repository';
import { SubconsciousProposalPrismaRepository } from './infrastructure/subconscious-proposal.prisma.repository';

// SubconsciousModule — proactive engine 전체 조립.
// Task 7 (Proposal 라이프사이클) + Task 8 (Scheduler + Processor + 전체 wiring).
//
// 순환 참조:
//   SlackModule → SubconsciousModule → SlackModule (proposal DM 발송)
//   → forwardRef(SlackModule) 로 해소.
//
// Redis: RouterModule 과 동일 패턴으로 ConfigService 에서 REDIS_HOST/PORT 를 읽어
// SubconsciousModule 전용 IORedis 인스턴스를 생성한다 (BullMQ connection 과 분리).
@Module({
  imports: [
    BullModule.registerQueue({ name: SUBCONSCIOUS_TICK_QUEUE }),
    GithubModule,
    NotionModule,
    SlackInboxModule,
    ModelRouterModule,
    // IDAERI_ROUTER_PORT (IdaeriRouterUsecase) — proposal apply 시 worker dispatch.
    RouterModule,
    // SlackService (postProposalMessage) — DM 버튼 메시지 발송.
    // forwardRef: SlackModule → SubconsciousModule → SlackModule 순환 방지.
    forwardRef(() => SlackModule),
    PrismaModule,
  ],
  providers: [
    // ── StateSource adapters ──────────────────────────────────────────────────
    GithubStateSource,
    NotionStateSource,
    SlackInboxStateSource,
    {
      // router.module.ts AGENT_DISPATCHER_PORT 패턴과 동일:
      // useFactory 가 모든 StateSource 인스턴스를 받아 배열로 합쳐 등록.
      provide: STATE_SOURCES,
      useFactory: (
        github: GithubStateSource,
        notion: NotionStateSource,
        slackInbox: SlackInboxStateSource,
      ): StateSource[] => [github, notion, slackInbox],
      inject: [GithubStateSource, NotionStateSource, SlackInboxStateSource],
    },
    // ── Gate ─────────────────────────────────────────────────────────────────
    LlmSubconsciousGate,
    {
      provide: SUBCONSCIOUS_GATE,
      useExisting: LlmSubconsciousGate,
    },
    // ── Promotion Budget (Redis sliding-window) ───────────────────────────────
    {
      provide: PROMOTION_BUDGET,
      useFactory: (configService: ConfigService): RedisPromotionBudget => {
        const redis = new Redis({
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
        const rawCap = configService.get<string>(
          'SUBCONSCIOUS_PROMOTION_BUDGET_PER_HOUR',
        );
        const capPerHour =
          rawCap && /^\d+$/.test(rawCap.trim())
            ? parseInt(rawCap.trim(), 10)
            : 4;
        return new RedisPromotionBudget(redis, capPerHour);
      },
      inject: [ConfigService],
    },
    // ── Baseline Repository ───────────────────────────────────────────────────
    {
      provide: SUBCONSCIOUS_BASELINE_REPOSITORY,
      useClass: SubconsciousBaselinePrismaRepository,
    },
    // ── Proposal Repository ───────────────────────────────────────────────────
    {
      provide: SUBCONSCIOUS_PROPOSAL_REPOSITORY,
      useClass: SubconsciousProposalPrismaRepository,
    },
    // ── Application services ──────────────────────────────────────────────────
    SubconsciousProposalService,
    {
      provide: PROPOSAL_EMITTER,
      useExisting: SubconsciousProposalService,
    },
    SubconsciousEngine,
    SubconsciousScheduler,
    SubconsciousTickProcessor,
  ],
  exports: [SubconsciousProposalService, PROPOSAL_EMITTER],
})
export class SubconsciousModule {}
