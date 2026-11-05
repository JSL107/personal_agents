import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewAction } from '../domain/preview-action.type';

// 승인된 카드의 payload 를 다시 읽을 때 쓴다(예: 릴스 카드 승인에 묶인 스토리를 나중에 올릴 때).
@Injectable()
export class FindPreviewByIdUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute(id: string): Promise<PreviewAction | null> {
    return await this.repository.findById(id);
  }
}
