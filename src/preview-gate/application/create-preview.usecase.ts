import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  CreatePreviewInput,
  PreviewAction,
} from '../domain/preview-action.type';

// PO-2: 새 PreviewAction 을 PENDING 상태로 만든다. 호출자 (PM-2 Write-back 등) 가 받은 PreviewAction
// id 를 Block Kit button value 로 박아 사용자에게 ✅ apply / ❌ cancel 보여준다.
@Injectable()
export class CreatePreviewUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute(input: CreatePreviewInput): Promise<PreviewAction> {
    return this.repository.create(input);
  }
}
