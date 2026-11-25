import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewStatus } from '../domain/preview-action.type';

export interface CountPreviewsByPayloadInput {
  readonly kind: string;
  readonly payloadPath: string[];
  // JSON 안의 값과 타입까지 같아야 일치한다 — 숫자로 저장된 id 는 숫자로 넘긴다.
  readonly payloadValue: string | number;
  readonly status?: PreviewStatus;
}

@Injectable()
export class CountPreviewsByPayloadUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute(input: CountPreviewsByPayloadInput): Promise<number> {
    return this.repository.countByPayloadValue(input);
  }
}
