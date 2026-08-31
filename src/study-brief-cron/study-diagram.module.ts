import { Module } from '@nestjs/common';

import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { NOTION_FILE_UPLOAD_PORT } from '../notion/domain/port/notion-file-upload.port';
import { NotionFileUploadClient } from '../notion/infrastructure/notion-file-upload.client';
import { GenerateStudyDiagramUsecase } from './application/generate-study-diagram.usecase';
import { STUDY_DIAGRAM_RENDERER_PORT } from './domain/port/study-diagram-renderer.port';
import { StudyDiagramRenderer } from './infrastructure/study-diagram.renderer';

// 그림 생성만 담은 모듈. StudyBriefCronModule 과 분리한 이유는 StudyDeepdiveModule 과 같다 —
// 그쪽은 스케줄러와 CTO 판정(PreviewGate 배선)을 함께 들고 있어서, 실증 CLI 가 그걸 올리면
// 실행 중인 서버의 BullMQ repeatable job 을 재등록해 남의 cron 을 지운다.
//
// ⚠️ 이 모듈은 **자기 의존성을 스스로 갖춰야 한다.** 하나라도 빠지면 cron 경로(이미 그 provider 를
//    가진 컨텍스트)에서는 돌고 CLI 만 부팅에 실패한다 — 매일 정상이라 아무도 모르는 상태가 된다.
@Module({
  providers: [
    GenerateStudyDiagramUsecase,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    { provide: STUDY_DIAGRAM_RENDERER_PORT, useClass: StudyDiagramRenderer },
    { provide: NOTION_FILE_UPLOAD_PORT, useClass: NotionFileUploadClient },
  ],
  exports: [GenerateStudyDiagramUsecase, NOTION_FILE_UPLOAD_PORT],
})
export class StudyDiagramModule {}
