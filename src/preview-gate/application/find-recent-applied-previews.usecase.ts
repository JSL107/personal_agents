import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewAction, PreviewKind } from '../domain/preview-action.type';

// 실제로 적용된 카드만 kind 별로 조회한다 — "정말 나갔는가" 를 물어야 하는 곳이 쓴다.
// 블로그 발행이 첫 소비자로, 같은 주제를 두 번 내보내지 않으려고 이미 나간 글을 확인한다.
@Injectable()
export class FindRecentAppliedPreviewsUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute({
    kind,
    since,
    limit,
  }: {
    kind: PreviewKind;
    since: Date;
    limit: number;
  }): Promise<PreviewAction[]> {
    return await this.repository.findRecentAppliedByKind({
      kind,
      since,
      limit,
    });
  }
}
