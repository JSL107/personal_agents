import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { CollectJobPostingsUsecase } from '../src/job-feed/application/collect-job-postings.usecase';
import { ListNotifiablePostingsUsecase } from '../src/job-feed/application/list-notifiable-postings.usecase';
import { ReprocessJobPostingsUsecase } from '../src/job-feed/application/reprocess-job-postings.usecase';
import { ScoreJobPostingsUsecase } from '../src/job-feed/application/score-job-postings.usecase';
import { parseJobFeedCliArguments } from '../src/job-feed/interface/job-feed-cli.parser';
import { JobFeedModule } from '../src/job-feed/job-feed.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

// AppModule 전체를 올리면 AutopilotScheduler 가 함께 떠서 운영 중인 정기 실행 등록을 건드린다.
// 필요한 모듈만 올린다.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    JobFeedModule,
  ],
})
class JobFeedCliModule {}

interface ProfileTechTags {
  techTags: string[];
  profileId: number | null;
}

interface ProfileJsonShape {
  accomplishments?: Array<{ techTags?: string[] }>;
}

const loadProfileTechTags = async (
  prisma: PrismaService,
  ownerSlackUserId: string | undefined,
): Promise<ProfileTechTags> => {
  const profile = await prisma.careerProfile.findFirst({
    // AUTOPILOT_OWNER_SLACK_USER_ID 가 있으면 그 owner 의 프로필만 본다 — 없으면
    // (autopilot task 와 달리 이 CLI 는 로컬 1인 진단 도구 전제라) 기존처럼 전체에서
    // 최신 프로필을 쓴다. 값이 있는데도 필터를 안 걸면 다른 사용자의 프로필로 채점한
    // CLI 출력이 실 운영(autopilot task)과 어긋나 보인다.
    where:
      ownerSlackUserId === undefined
        ? undefined
        : { slackUserId: ownerSlackUserId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, profileJson: true },
  });
  if (profile === null) {
    return { techTags: [], profileId: null };
  }
  const data = profile.profileJson as ProfileJsonShape;
  const techTags = (data.accomplishments ?? []).flatMap((item) => {
    return item.techTags ?? [];
  });
  return { techTags: [...new Set(techTags)], profileId: profile.id };
};

const main = async (): Promise<void> => {
  const options = parseJobFeedCliArguments(process.argv.slice(2));

  const application =
    await NestFactory.createApplicationContext(JobFeedCliModule);

  try {
    const prisma = application.get(PrismaService);
    const ownerSlackUserId = application
      .get(ConfigService)
      .get<string>('AUTOPILOT_OWNER_SLACK_USER_ID');
    const { techTags, profileId } = await loadProfileTechTags(
      prisma,
      ownerSlackUserId,
    );

    if (options.command === 'reprocess') {
      const result = await application
        .get(ReprocessJobPostingsUsecase)
        .execute();
      console.log(
        `재파생 — 대상 ${result.examined}건 중 ${result.changed}건 갱신`,
      );
    }

    if (options.command === 'collect') {
      const collect = await application.get(CollectJobPostingsUsecase).execute({
        maxPages: options.maxPages,
        dryRun: options.dryRun,
      });

      for (const outcome of collect.outcomes) {
        console.log(
          `${outcome.source}: ${outcome.status} — 수신 ${outcome.received} / 검증 ${outcome.validated} / 백엔드 ${outcome.accepted}${
            outcome.error === null ? '' : ` (${outcome.error})`
          }`,
        );
      }
      console.log(
        `저장: 신규 ${collect.upsert.created} · 갱신 ${collect.upsert.updated} · 요건변경 ${collect.upsert.contentChanged}`,
      );

      if (options.explain) {
        console.log(
          `프로필 기술 토큰 ${techTags.length}개 (프로필 id=${profileId ?? '없음'})`,
        );
        console.log('사전 미매칭 상위 15:');
        for (const entry of collect.unmatchedSkillTags.slice(0, 15)) {
          console.log(`  ${entry.tag} × ${entry.count}`);
        }
      }
    }

    if (options.command === 'digest') {
      // 선점(claimForNotification) 은 usecase 가 더 이상 여기서 하지 않는다 — 발송이
      // 성공한 뒤에만 별도로 한다(job-feed.autopilot-task.ts 의 onDelivered 참조).
      // 이 CLI 는 후보를 보여주기만 하고 그 콜백을 부르지 않으므로 선점도 안 일어난다.
      const postings = await application
        .get(ListNotifiablePostingsUsecase)
        .execute({ threshold: 0, limit: 10 });
      for (const posting of postings) {
        console.log(
          `[${posting.matchScore ?? 0}] ${posting.company} — ${posting.title} (${posting.skillTags.join(', ')})`,
        );
      }
    }

    // reprocess 는 saveSkillTags 가 채점 표식을 지우므로, digest 를 제외한 모든
    // 명령 뒤에 채점을 이어 붙인다 — collect 때와 동일한 조건이다.
    if (options.command !== 'digest' && !options.dryRun) {
      const score = await application.get(ScoreJobPostingsUsecase).execute({
        techTags,
        years: null,
        locations: [],
        profileId,
      });
      if (score.skipped) {
        console.log(`채점 건너뜀 — ${score.reason ?? ''}`);
      } else {
        console.log(
          `채점 ${score.scored}건 · 분포 ${JSON.stringify(score.histogram)}`,
        );
      }
    }
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
