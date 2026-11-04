import { readFile, writeFile } from 'node:fs/promises';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import {
  PublishPortfolioSiteResult,
  PublishPortfolioSiteUsecase,
} from '../src/agent/career-mate/application/publish-portfolio-site.usecase';
import { CareerMateModule } from '../src/agent/career-mate/career-mate.module';
import { PortfolioSyncPlan } from '../src/agent/career-mate/domain/portfolio-sync-card.type';
import { parsePortfolioSyncPlan } from '../src/agent/career-mate/domain/portfolio-sync-plan.parse';
import { AgentRunModule } from '../src/agent-run/agent-run.module';
import { CronIdempotencyModule } from '../src/common/queue/cron-idempotency.module';
import { formatKstDateTime } from '../src/common/util/kst-date.util';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';

// 사용법:
//   pnpm portfolio:publish --owner <SLACK_USER_ID> --dry-run --out plan.json
//   pnpm portfolio:publish --owner <SLACK_USER_ID> --apply plan.json
//   pnpm portfolio:publish --owner <SLACK_USER_ID>
//
// autopilot 이 매일 23:00 에 하는 것과 **같은 usecase** 를 부른다. 발행 경로를 실증하는 유일한
// 수동 입구다 — 지금까지는 cron 말고 부르는 곳이 없어(portfolio-publish.autopilot-task) 발행
// 결과를 확인하려면 다음 발화까지 기다려야 했다.
//
// ⚠️ AppModule 전체를 부팅하지 않는다. 전체 부팅은 실행 중인 서버의 BullMQ repeatable job 을
//    재등록해 남의 cron 을 지운다. 필요한 모듈만 올린다.
const USAGE = [
  '사용법:',
  '  pnpm portfolio:publish --owner <SLACK_USER_ID> --dry-run --out <path>',
  '  pnpm portfolio:publish --owner <SLACK_USER_ID> --apply <path>',
  '  pnpm portfolio:publish --owner <SLACK_USER_ID>',
].join('\n');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentRunModule,
    // REDIS_HOST/PORT 가 없으면 잠금은 in-memory 이며 CLI 프로세스 간에는 공유되지 않는다.
    CronIdempotencyModule,
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

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const formatList = ({
  label,
  values,
}: {
  label: string;
  values: string[];
}): string | null => {
  if (values.length === 0) {
    return null;
  }
  return `  ${label} ${values.length}건 — ${values.join(', ')}`;
};

const printPlan = (plan: PortfolioSyncPlan): void => {
  const lines = [
    `포트폴리오 발행 계획 (${plan.cards.length}장, ${plan.createdAt})`,
    `기준 fingerprint: ${plan.baseFingerprint}`,
  ];
  if (plan.adoption) {
    lines.push('채택 대조표:');
    for (const row of plan.adoption.table) {
      lines.push(`  ${row.slug} | ${row.siteProjectId} | ${row.title}`);
    }
    if (plan.adoption.mismatch) {
      lines.push(
        `  ⚠️ 계획에만 있음: ${plan.adoption.mismatch.onlyInPlan.join(', ') || '없음'}`,
        `  ⚠️ 사이트에만 있음: ${plan.adoption.mismatch.onlyOnSite.join(', ') || '없음'}`,
      );
    }
  }
  for (const card of plan.cards) {
    const body = card.body;
    const process = Array.isArray(body.process) ? body.process : [];
    const techStack = Array.isArray(body.techStack) ? body.techStack : [];
    lines.push(
      `${card.slug}: ${card.action}, 표지 재생성 ${card.regenerate}, 검증 ${card.coverPassed}, 과정 ${process.length}줄`,
      `  기술: ${techStack.join(', ') || '없음'}`,
      `  링크: ${JSON.stringify(body.links ?? {})}`,
      `  sortOrder: ${card.sortOrderSent ?? '보존'}`,
    );
  }
  lines.push(`보고: ${JSON.stringify(plan.report, null, 2)}`);
  console.log(lines.join('\n'));
};

const printResult = (result: PublishPortfolioSiteResult): void => {
  const blankedFields = result.blankedFields.map(
    (entry) => `${entry.slug}(${entry.fields.join(', ')})`,
  );
  const postCheckViolations = result.postCheckViolations.map(
    (entry) => `${entry.slug}(기준 ${entry.rule}: ${entry.detail})`,
  );
  const failures = result.failures.map(
    (failure) => `${failure.target}(${failure.reason})`,
  );
  const lines = [
    `포트폴리오 사이트 발행 (run #${result.agentRunId})`,
    formatList({ label: '신규', values: result.createdProjects }),
    formatList({ label: '갱신', values: result.updatedProjects }),
    formatList({ label: '새 스킬 그룹', values: result.createdSkillGroups }),
    formatList({ label: '건너뜀(근거 PR 없음)', values: result.skippedTitles }),
    formatList({
      label: '⚠️ 이름을 받지 못해 빠진 저장소',
      values: result.unnamedKeys,
    }),
    formatList({ label: '표지 새로 씀', values: result.regenerated }),
    formatList({
      label: '⚠️ 공개 표지 덮음',
      values: result.overwrittenPublic,
    }),
    formatList({ label: '⚠️ 표지 생성 실패', values: result.coverFailed }),
    formatList({
      label: '⚠️ 계획에 없는 이대리 카드',
      values: result.notInPlan,
    }),
    formatList({
      label: '⚠️ 알 수 없는 기술',
      values: result.unknownTechTerms,
    }),
    formatList({ label: '⚠️ 계획 위반', values: result.planViolations }),
    formatList({ label: '⚠️ 비워낸 표지 필드', values: blankedFields }),
    formatList({ label: '⚠️ 사후 검사 위반', values: postCheckViolations }),
    formatList({ label: '⚠️ 실패', values: failures }),
    formatList({
      label: '⚠️ 재조회에 없음',
      values: result.missingAfterPublish,
    }),
    result.adoptionRequired
      ? '⚠️ 채택 전 — CLI --dry-run/--apply 로 첫 채택 필요'
      : null,
    result.aborted ? `⚠️ 중단: ${result.aborted}` : null,
  ].filter((line): line is string => line !== null);
  console.log(lines.join('\n'));
};

const hasFailure = (result: PublishPortfolioSiteResult): boolean => {
  const hasReportedFailure =
    result.failures.length > 0 ||
    result.missingAfterPublish.length > 0 ||
    result.unnamedKeys.length > 0 ||
    result.coverFailed.length > 0 ||
    result.blankedFields.length > 0 ||
    result.postCheckViolations.length > 0 ||
    result.notInPlan.length > 0 ||
    result.planViolations.length > 0;
  // 채택 전이면 아무것도 쓰지 않았다 — 성공 종료로 두면 자동화가 미발행을 정상으로 읽는다.
  const isUnpublished = result.adoptionRequired || result.aborted !== null;
  return hasReportedFailure || isUnpublished;
};

const main = async (): Promise<void> => {
  const dryRun = hasFlag('dry-run');
  const apply = hasFlag('apply');
  const outputPath = readOption('out');
  const planPath = readOption('apply');
  const invalidOptions =
    (dryRun && apply) || (dryRun && !outputPath) || (apply && !planPath);
  if (invalidOptions) {
    throw new Error(USAGE);
  }
  const owner =
    readOption('owner') ?? process.env.AUTOPILOT_OWNER_SLACK_USER_ID;
  if (!owner && !apply) {
    throw new Error(`owner 를 알 수 없습니다.\n${USAGE}`);
  }

  const app = await NestFactory.createApplicationContext(
    PublishPortfolioCliModule,
    { logger: ['error', 'warn', 'log'] },
  );
  try {
    const usecase = app.get(PublishPortfolioSiteUsecase);
    if (dryRun) {
      const plan = await usecase.plan({ slackUserId: owner! });
      await writeFile(
        outputPath!,
        `${JSON.stringify(plan, null, 2)}\n`,
        'utf8',
      );
      printPlan(plan);
      if (plan.adoption?.mismatch) {
        process.exitCode = 1;
      }
      return;
    }
    if (apply) {
      const planText = await readFile(planPath!, 'utf8');
      const rawPlan: unknown = JSON.parse(planText);
      const plan = parsePortfolioSyncPlan(rawPlan);
      const result = await usecase.apply({
        plan,
        options: {
          snapshot: async (projects) => {
            const timestamp = formatKstDateTime(new Date()).replace(/\D/g, '');
            await writeFile(
              `${planPath}.snapshot-${timestamp}.json`,
              `${JSON.stringify(projects, null, 2)}\n`,
              'utf8',
            );
          },
        },
      });
      printResult(result);
      if (hasFailure(result)) {
        process.exitCode = 1;
      }
      return;
    }
    const result = await usecase.execute({ slackUserId: owner! });
    printResult(result);
    if (hasFailure(result)) {
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
