import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import {
  NOTION_FILE_UPLOAD_PORT,
  NotionFileUploadPort,
} from '../src/notion/domain/port/notion-file-upload.port';
import { PrismaModule } from '../src/prisma/prisma.module';
import { GenerateStudyDiagramUsecase } from '../src/study-brief-cron/application/generate-study-diagram.usecase';
import {
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../src/study-brief-cron/domain/port/study-brief.repository.port';
import { StudyBriefPrismaRepository } from '../src/study-brief-cron/infrastructure/study-brief.prisma.repository';
import { StudyDiagramModule } from '../src/study-brief-cron/study-diagram.module';

// 사용법:
//   pnpm study:diagram                # 가장 최근 공부 1건으로 그림 생성 + 노션 업로드
//   pnpm study:diagram --id 42        # 특정 공부 건
//   pnpm study:diagram --dry          # 업로드 없이 HTML·PNG 만 저장
//   pnpm study:diagram --owner U123   # 소유자 지정 (기본은 STUDY_BRIEF_OWNER_SLACK_USER_ID)
//
// 09:30 cron 이 부르는 것과 **같은 usecase** 를 부른다. 트리거가 자동뿐이면 검증이
// 다음 발화까지 묶이므로 실증 입구를 따로 둔다.
//
// ⚠️ AppModule 이나 StudyBriefCronModule 을 올리지 않는다. 그쪽은 스케줄러를 들고 있어
//    실행 중인 서버의 BullMQ repeatable job 을 재등록한다. 그림 전용 경량 모듈만 올린다.
const USAGE = [
  '사용법:',
  '  pnpm study:diagram [--id <번호>] [--owner <SLACK_USER_ID>] [--dry]',
].join('\n');

const OUTPUT_DIR = join(process.cwd(), 'tmp', 'study-diagram');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StudyDiagramModule,
  ],
  providers: [
    {
      provide: STUDY_BRIEF_REPOSITORY_PORT,
      useClass: StudyBriefPrismaRepository,
    },
  ],
})
class StudyDiagramCliModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const toSlug = (topic: string): string =>
  topic
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'study';

const main = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(
    StudyDiagramCliModule,
    { logger: ['error', 'warn', 'log'] },
  );
  try {
    const repository = app.get<StudyBriefRepositoryPort>(
      STUDY_BRIEF_REPOSITORY_PORT,
    );
    const configService = app.get(ConfigService);
    const idOption = readOption('id');
    const owner =
      readOption('owner') ??
      configService.get<string>('STUDY_BRIEF_OWNER_SLACK_USER_ID');

    if (idOption === undefined && !owner) {
      throw new Error(
        `owner 를 알 수 없습니다. --owner 로 넘기거나 STUDY_BRIEF_OWNER_SLACK_USER_ID 를 설정하세요.\n${USAGE}`,
      );
    }

    const brief =
      idOption !== undefined
        ? await repository.findById(Number(idOption))
        : await repository.findLatest(owner as string);
    if (!brief) {
      throw new Error(
        `대상 공부 기록을 찾지 못했습니다 (${idOption !== undefined ? `id=${idOption}` : `owner=${owner ?? ''}`}).`,
      );
    }
    console.log(`대상: #${brief.id} ${brief.topic} (${brief.kind})`);

    const usecase = app.get(GenerateStudyDiagramUsecase);
    // 거부된 그림도 받아 눈으로 본다. 사유 텍스트만으로는 무엇을 고칠지 판단하기 느리다.
    const diagram = await usecase.execute(
      { topic: brief.topic, kind: brief.kind, reportMd: brief.reportMd },
      { keepRejected: true },
    );
    if (diagram === null) {
      console.error(
        '그림을 만들지 못했습니다. 위 로그의 거부 사유를 확인하세요. ' +
          '(STUDY_DIAGRAM_ENABLED 가 true 인지도 함께 확인)',
      );
      process.exitCode = 1;
      return;
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const base = join(OUTPUT_DIR, `${brief.id}-${toSlug(brief.topic)}`);
    writeFileSync(`${base}.html`, diagram.html, 'utf-8');
    writeFileSync(`${base}.png`, diagram.png);
    console.log(`HTML: ${base}.html`);
    console.log(`PNG : ${base}.png`);

    if (diagram.violations.length > 0) {
      console.error('기준 미달 — cron 이었다면 그림 없이 발행됐을 그림입니다:');
      for (const violation of diagram.violations) {
        console.error(`  [${violation.rule}] ${violation.detail}`);
      }
      process.exitCode = 1;
      return;
    }

    if (hasFlag('dry')) {
      console.log('--dry 라 업로드는 건너뜁니다.');
      return;
    }

    const uploader = app.get<NotionFileUploadPort>(NOTION_FILE_UPLOAD_PORT);
    const fileUploadId = await uploader.uploadImage({
      filename: `${brief.id}-diagram.png`,
      png: diagram.png,
    });
    console.log(`file_upload id: ${fileUploadId}`);
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
