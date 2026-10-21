import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewStatus } from '../domain/preview-action.type';

export interface CountPreviewsByPayloadInput {
  readonly kind: string;
  readonly payloadPath: string[];
  readonly payloadValue: string;
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
