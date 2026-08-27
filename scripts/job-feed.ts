import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { CollectJobPostingsUsecase } from '../src/job-feed/application/collect-job-postings.usecase';
import { ListNotifiablePostingsUsecase } from '../src/job-feed/application/list-notifiable-postings.usecase';
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
): Promise<ProfileTechTags> => {
  const profile = await prisma.careerProfile.findFirst({
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

  // ReprocessJobPostingsUsecase 는 Task 13-A 에서 추가한다. 파서는 명령을
  // 미리 받아 두지만(테스트도 그대로) 여기서는 아직 처리하지 않는다 —
  // AppModule 을 올려놓고 아무 일도 안 하는 대신 명시적으로 안내만 한다.
  if (options.command === 'reprocess') {
    console.log(
      'reprocess 명령은 아직 구현되지 않았습니다 (Task 13-A 에서 추가 예정입니다).',
    );
    return;
  }

  const application =
    await NestFactory.createApplicationContext(JobFeedCliModule);

  try {
    const prisma = application.get(PrismaService);
    const { techTags, profileId } = await loadProfileTechTags(prisma);

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

      if (!options.dryRun) {
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
    }

    if (options.command === 'digest') {
      const postings = await application
        .get(ListNotifiablePostingsUsecase)
        .execute({ threshold: 0, limit: 10, peek: true });
      for (const posting of postings) {
        console.log(
          `[${posting.matchScore ?? 0}] ${posting.company} — ${posting.title} (${posting.skillTags.join(', ')})`,
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
