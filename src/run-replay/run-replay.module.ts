import { Module } from '@nestjs/common';

import { BlogModule } from '../agent/blog/blog.module';
import { CeoModule } from '../agent/ceo/ceo.module';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { PaperRecommendModule } from '../agent/paper-recommend/paper-recommend.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { VideoWatchModule } from '../agent/video-watch/video-watch.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { PaperTradingModule } from '../paper-trading/paper-trading.module';
import { ReplayFailedRunUsecase } from './application/replay-failed-run.usecase';
import { ReplayInFlightLock } from './application/replay-in-flight.lock';

// 실패 실행 재실행 — Slack `/retry-run` 과 콘솔 재시도 버튼이 함께 쓴다.
// AgentRunModule 은 각 에이전트 모듈이 가져다 쓰는 하위 모듈이라 거기 두면 순환이 생겨 따로 뺐다.
@Module({
  imports: [
    AgentRunModule,
    BlogModule,
    CeoModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PaperRecommendModule,
    PaperTradingModule,
    PmAgentModule,
    PoEvalModule,
    PoShadowModule,
    VideoWatchModule,
    WorkReviewerModule,
  ],
  providers: [ReplayFailedRunUsecase, ReplayInFlightLock],
  exports: [ReplayFailedRunUsecase],
})
export class RunReplayModule {}
