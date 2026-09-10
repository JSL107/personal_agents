import { Inject, Injectable } from '@nestjs/common';

import { PreferenceSignalSource } from '../domain/port/preference-signal-source.port';
import {
  REACTION_SIGNAL_REPOSITORY,
  ReactionSignalRepositoryPort,
  ReactionSignalRow,
} from '../domain/port/reaction-signal.repository.port';
import { PreferenceSignal } from '../domain/preference-signal.type';

// 여러 신호가 한 프롬프트에 함께 실리므로 메시지 본문은 300자로 자른다 — 다른 신호원
// (preview_decision 200자) 보다 여유를 둔 이유는 봇 메시지 원문이 판단 근거의 전부이기 때문.
const TEXT_CAP = 300;

// 회차당 신호 상한. 형제 소스(preview_decision)가 ROW_CAP 50 을 두는 것과 같은 이유다 —
// 수집기는 소스 순서대로 모아 마지막에 앞에서 자르므로(PreferenceSignalCollector.collect),
// 한 소스가 쏟아내면 그 뒤 소스가 통째로 밀려난다. 반응은 클릭 한 번이라 다른 신호원보다
// 쉽게 쌓이는 쪽이어서 상한이 특히 필요하다.
const ROW_CAP = 50;

// 저장 시점에 handler 가 이미 이 두 종류로만 걸러 저장한다 — 여기서는 긍정/부정 라벨만 가른다.
const POSITIVE_EMOJIS = ['+1', 'thumbsup'];

// 세 번째 신호원 — 사용자가 이대리 메시지에 남긴 👍/👎.
// ProposalDecisionSignalSource(선호 카드) · PreviewDecisionSignalSource(PreviewGate 결정)
// 와 달리 별도 워크플로 없이 즉흥적으로 남기는 호오라 콜드 스타트 해소에 특히 유효하다.
@Injectable()
export class ReactionSignalSource implements PreferenceSignalSource {
  readonly name = 'reaction';

  constructor(
    @Inject(REACTION_SIGNAL_REPOSITORY)
    private readonly reactionRepository: ReactionSignalRepositoryPort,
  ) {}

  async fetch(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<PreferenceSignal[]> {
    const reactions = await this.reactionRepository.recentReactions(
      ownerUserId,
      sinceMs,
    );
    return reactions
      .slice(0, ROW_CAP)
      .map((reaction) => this.toSignal(reaction));
  }

  private toSignal(reaction: ReactionSignalRow): PreferenceSignal {
    const label = POSITIVE_EMOJIS.includes(reaction.emoji)
      ? '좋아함'
      : '싫어함';
    return {
      source: 'reaction',
      evidenceRef: `slackReaction:${reaction.id}`,
      observedText: `[${label}] ${reaction.messageText.slice(0, TEXT_CAP)}`,
    };
  }
}
