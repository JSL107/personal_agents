import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';

export interface CountPreviewsByPayloadInput {
  readonly kind: string;
  readonly payloadPath: string[];
  readonly payloadValue: string;
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
