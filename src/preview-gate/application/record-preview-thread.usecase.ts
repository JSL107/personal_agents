import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';

@Injectable()
export class RecordPreviewThreadUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute({
    id,
    slackChannelId,
    slackThreadTs,
  }: {
    id: string;
    slackChannelId: string;
    slackThreadTs: string;
  }): Promise<void> {
    await this.repository.attachSlackThread({
      id,
      slackChannelId,
      slackThreadTs,
    });
  }
}
