import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewAction } from '../domain/preview-action.type';

// 자연어 Y/N 응답 흐름의 진입점 — 사용자가 "응" / "아니" 등으로 답했을 때
// 어떤 preview 에 대한 응답인지 결정하기 위해 사용자별 최근 PENDING preview 1건 조회.
//
// RouterMessageHandler 가 dispatch 전 본 usecase 를 먼저 호출 → null 이면 일반 intent
// 분류 경로로 진행, 있으면 사용자 입력을 YES/NO 패턴 매칭해 ApplyPreviewUsecase /
// CancelPreviewUsecase 로 위임.
@Injectable()
export class FindLatestPendingPreviewUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute({
    slackUserId,
    now = new Date(),
  }: {
    slackUserId: string;
    now?: Date;
  }): Promise<PreviewAction | null> {
    return this.repository.findLatestPendingForUser({ slackUserId, now });
  }
}
