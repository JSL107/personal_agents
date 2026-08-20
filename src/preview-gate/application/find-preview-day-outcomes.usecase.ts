import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
  PreviewDayOutcomeRow,
} from '../domain/port/preview-action.repository.port';

// 대표 브리핑 연속 기록 — 승인 카드가 언제 떠서 언제 결말이 났는지만 전건 조회한다.
// 판정(그날 안에 다 처리했는가)은 console 쪽 순수 함수(`calculateStreak`)가 한다.
@Injectable()
export class FindPreviewDayOutcomesUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute(): Promise<PreviewDayOutcomeRow[]> {
    return await this.repository.findAllDayOutcomes();
  }
}
