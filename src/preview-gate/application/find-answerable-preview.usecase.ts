import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_ANSWER_WINDOW_MS,
  PreviewAction,
} from '../domain/preview-action.type';

export type PreviewAnswerScope =
  | { kind: 'SLACK_THREAD'; channelId: string; threadTs: string }
  | { kind: 'SLACK_TOP_LEVEL'; channelId: string }
  | { kind: 'CONSOLE' };

export type AnswerablePreviewResult =
  | { status: 'NONE' }
  | { status: 'ONE'; preview: PreviewAction }
  | { status: 'AMBIGUOUS' };

type AnswerCandidateFilter = {
  slackChannelId?: string;
  slackThreadTs?: string;
  createdSince?: Date;
};

// 자연어 "응/아니" 가 어느 카드에 대한 답인지 정한다. 예전에는 사용자의 가장 최근 PENDING 카드를
// 골라, 다른 대화에서 친 "응" 이 몇 시간 전 다른 스레드의 외부 쓰기 카드(블로그 GitHub 발행 등)를
// 승인했다. 이제는 답이 놓인 자리로 좁힌다 — 스레드 답이면 그 스레드의 카드, 스레드 밖이면 같은
// 채널(콘솔은 채널 없음)의 최근 카드. 둘 이상이면 고르지 않고 AMBIGUOUS 로 돌려준다.
// 좌표가 없는 카드(ephemeral 슬래시 카드 등)는 스레드·채널 조건에 걸리지 않아 버튼으로만 처리된다.
@Injectable()
export class FindAnswerablePreviewUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute({
    slackUserId,
    now = new Date(),
    scope,
  }: {
    slackUserId: string;
    now?: Date;
    scope: PreviewAnswerScope;
  }): Promise<AnswerablePreviewResult> {
    // 0 / 1 / 둘 이상만 가르면 되므로 2건까지만 읽는다.
    const candidates = await this.repository.findPendingAnswerCandidates({
      slackUserId,
      now,
      limit: 2,
      ...toCandidateFilter({ scope, now }),
    });

    if (candidates.length === 0) {
      return { status: 'NONE' };
    }
    if (candidates.length > 1) {
      return { status: 'AMBIGUOUS' };
    }
    return { status: 'ONE', preview: candidates[0] };
  }
}

const toCandidateFilter = ({
  scope,
  now,
}: {
  scope: PreviewAnswerScope;
  now: Date;
}): AnswerCandidateFilter => {
  const createdSince = new Date(now.getTime() - PREVIEW_ANSWER_WINDOW_MS);
  switch (scope.kind) {
    case 'SLACK_THREAD':
      return { slackChannelId: scope.channelId, slackThreadTs: scope.threadTs };
    case 'SLACK_TOP_LEVEL':
      return { slackChannelId: scope.channelId, createdSince };
    case 'CONSOLE':
      return { createdSince };
  }
};
