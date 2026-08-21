import { Module } from '@nestjs/common';

import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { CronIdempotencyModule } from '../common/queue/cron-idempotency.module';
import { NotionModule } from '../notion/notion.module';
import { ExpandStudyBriefUsecase } from './application/expand-study-brief.usecase';
import { REPO_CONTEXT_PORT } from './domain/port/repo-context.port';
import { STUDY_BRIEF_REPOSITORY_PORT } from './domain/port/study-brief.repository.port';
import { RepoContextCollector } from './infrastructure/repo-context.collector';
import { StudyBriefPrismaRepository } from './infrastructure/study-brief.prisma.repository';

// 딥다이브 확장만 담은 모듈. StudyBriefCronModule 과 분리한 이유:
// 그쪽은 주제 판정을 위해 CtoModule 을 끌고 오고, CtoModule 은 승인 게이트(PreviewGate)를
// 요구한다. 확장 단계는 CTO 판정을 쓰지 않는데, 한 모듈에 묶어 두면 이 기능을 쓰려는 쪽
// (autopilot task · 실증 CLI)이 승인 게이트 배선까지 재현해야 한다 — CLI 는 실제로 그 지점에서
// 부팅에 실패했다.
// ⚠️ 이 모듈은 **자기 의존성을 스스로 갖춰야 한다.** usecase 가 확장 구간을 잠그려고
// CronIdempotencyService 를 받는데 여기 없으면, autopilot(그 서비스를 이미 가진 컨텍스트)에서는
// 돌고 CLI 만 부팅에 실패한다. 실제로 그 상태였다 — cron 은 매일 정상이라 아무도 몰랐고,
// 실증 입구는 있는데 실행하면 죽는 상태로 남아 있었다(위 주석의 PreviewGate 사고와 같은 종류).
@Module({
  imports: [AgentRunModule, NotionModule, CronIdempotencyModule],
  providers: [
    ExpandStudyBriefUsecase,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    {
      provide: STUDY_BRIEF_REPOSITORY_PORT,
      useClass: StudyBriefPrismaRepository,
    },
    { provide: REPO_CONTEXT_PORT, useClass: RepoContextCollector },
  ],
  exports: [ExpandStudyBriefUsecase],
})
export class StudyDeepdiveModule {}
