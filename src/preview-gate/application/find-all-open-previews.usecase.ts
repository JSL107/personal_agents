import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewAction } from '../domain/preview-action.type';

// 콘솔 관제 — 현재 열려 있는(PENDING & 미만료) preview 전체를 사용자 구분 없이 조회한다.
// ConsoleReadService 가 스냅샷의 approvals 목록 + AWAITING_APPROVAL 상태 파생 신호로 소비한다.
@Injectable()
export class FindAllOpenPreviewsUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute({
    now = new Date(),
  }: {
    now?: Date;
  }): Promise<PreviewAction[]> {
    return this.repository.findAllOpen({ now });
  }
}
