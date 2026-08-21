import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PublishPortfolioSiteUsecase } from '../src/agent/career-mate/application/publish-portfolio-site.usecase';
import { CareerMateModule } from '../src/agent/career-mate/career-mate.module';
import { AgentRunModule } from '../src/agent-run/agent-run.module';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';

// 사용법:
//   pnpm exec ts-node scripts/publish-portfolio.ts --owner <SLACK_USER_ID>
//
// autopilot 이 매일 23:00 에 하는 것과 **같은 usecase** 를 부른다. 발행 경로를 실증하는 유일한
// 수동 입구다 — 지금까지는 cron 말고 부르는 곳이 없어(portfolio-publish.autopilot-task) 발행
// 결과를 확인하려면 다음 발화까지 기다려야 했다.
//
// ⚠️ AppModule 전체를 부팅하지 않는다. 전체 부팅은 실행 중인 서버의 BullMQ repeatable job 을
//    재등록해 남의 cron 을 지운다. 필요한 모듈만 올린다.
const USAGE =
  '사용법:\n  pnpm exec ts-node scripts/publish-portfolio.ts --owner <SLACK_USER_ID>';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentRunModule,
    // CareerMateModule 의 형제 usecase(AnalyzeJdGapUsecase)가 CreatePreviewUsecase 를 물고 있어
    // 게이트가 없으면 모듈 자체가 뜨지 않는다. 발행은 승인 카드를 쓰지 않으므로 applier 를
    // 하나도 등록하지 않은 빈 게이트로 의존만 채운다 — 이 CLI 에서 카드가 생길 일은 없다.
    PreviewGateModule.forRoot({ appliers: [] }),
    CareerMateModule,
  ],
})
class PublishPortfolioCliModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const formatList = (label: string, values: string[]): string | null => {
  if (values.length === 0) {
    return null;
  }
  return `  ${label} ${values.length}건 — ${values.join(', ')}`;
};

const main = async (): Promise<void> => {
  const owner =
    readOption('owner') ?? process.env.AUTOPILOT_OWNER_SLACK_USER_ID;
  if (!owner) {
    throw new Error(
      `owner 를 알 수 없습니다. --owner 로 넘기거나 AUTOPILOT_OWNER_SLACK_USER_ID 를 설정하세요.\n${USAGE}`,
    );
  }

  const app = await NestFactory.createApplicationContext(
    PublishPortfolioCliModule,
    { logger: ['error', 'warn', 'log'] },
  );
  try {
    const result = await app
      .get(PublishPortfolioSiteUsecase)
      .execute({ slackUserId: owner });
    const lines = [
      `포트폴리오 사이트 발행 (run #${result.agentRunId})`,
      formatList('신규', result.createdProjects),
      formatList('갱신', result.updatedProjects),
      formatList('새 스킬 그룹', result.createdSkillGroups),
      formatList('건너뜀(근거 PR 없음)', result.skippedTitles),
      // 이름을 못 받은 묶음은 그 저장소 작업이 통째로 빠진 것이다. 출력하지 않으면 운영자가
      // 부분 손실을 정상 발행으로 읽는다.
      formatList('⚠️ 이름을 받지 못해 빠진 저장소', result.unnamedKeys),
      formatList(
        '⚠️ 실패',
        result.failures.map(
          (failure) => `${failure.target}(${failure.reason})`,
        ),
      ),
      formatList('⚠️ 재조회에 없음', result.missingAfterPublish),
      '',
      '발행물은 published:false 초안이다. 사이트 편집기에서 게시해야 공개된다.',
    ].filter((line): line is string => line !== null);
    console.log(lines.join('\n'));
    // 실패가 있으면 종료 코드로 알린다 — 파이프에 물려도 초록으로 지나가지 않게 한다.
    // unnamedKeys 도 실패로 센다. execute 자체는 성공하지만 그 저장소는 발행되지 않았다.
    if (
      result.failures.length > 0 ||
      result.missingAfterPublish.length > 0 ||
      result.unnamedKeys.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
