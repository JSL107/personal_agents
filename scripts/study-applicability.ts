import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PrismaModule } from '../src/prisma/prisma.module';
import { JudgeStudyApplicabilityUsecase } from '../src/study-brief-cron/application/judge-study-applicability.usecase';
import {
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../src/study-brief-cron/domain/port/study-brief.repository.port';
import { parseStudyResearch } from '../src/study-brief-cron/domain/study-research.parser';
import { StudyApplicabilityModule } from '../src/study-brief-cron/study-applicability.module';

const USAGE =
  '사용법: pnpm study:applicability --id <브리프 번호> --keywords <a,b,c>';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StudyApplicabilityModule,
  ],
})
class StudyApplicabilityCliModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const id = Number(readOption('id'));
  const keywordsOption = readOption('keywords');
  if (!Number.isInteger(id) || !keywordsOption) {
    console.error(USAGE);
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(
    StudyApplicabilityCliModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const repository = app.get<StudyBriefRepositoryPort>(
      STUDY_BRIEF_REPOSITORY_PORT,
    );
    const brief = await repository.findById(id);
    if (!brief) {
      console.error(`브리프 #${id} 없음`);
      process.exitCode = 1;
      return;
    }
    const parsed = parseStudyResearch(
      `KIND: CONCEPT\nTOPIC: x\nKEYWORDS: ${keywordsOption}\n---\nx`,
    );
    const keywords = 'keywords' in parsed ? parsed.keywords : [];
    const { judgement, modelUsed } = await app
      .get(JudgeStudyApplicabilityUsecase)
      .judge({ ...brief, keywords, notionUrl: null });
    console.log(
      JSON.stringify(
        { briefId: id, topic: brief.topic, keywords, modelUsed, judgement },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
};

void main();
