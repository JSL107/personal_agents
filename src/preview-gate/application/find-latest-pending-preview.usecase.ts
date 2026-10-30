import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewAction } from '../domain/preview-action.type';

// 사용자별 최근 PENDING preview 1건 조회 — 지금은 갭 분석 뒤 "N번" 주제 선택만 쓴다.
// 자연어 "응/아니" 승인에는 쓰지 않는다: 대화와 무관한 카드를 고르므로 FindAnswerablePreviewUsecase 가 맡는다.
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
