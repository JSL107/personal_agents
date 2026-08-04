import { Injectable } from '@nestjs/common';

import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { PrismaService } from '../../prisma/prisma.service';
import { PreferenceSignalSource } from '../domain/port/preference-signal-source.port';
import { PreferenceSignal } from '../domain/preference-signal.type';

const TEXT_CAP = 200;
const ROW_CAP = 50;

// 두 번째 신호원 — PreviewGate 승인/거절 이력.
//
// ProposalDecisionSignalSource 가 읽는 preference_proposal 의 APPROVED/REJECTED 는 사실
// "선호 프로필 카드 한 종류(kind=PREFERENCE_PROFILE)" 에 대한 PreviewGate 결정이다. 이 소스는
// 같은 결정을 모든 kind 로 일반화한다 — 신호의 의미("사용자가 이 제안을 받아들였나 물렸나")는
// 동일하고 대상만 넓어진다.
//
// 그 결과 선호 학습이 스스로 만들지 않은 카드(SESSION_INJECT, EVENING_BLOG_PUBLISH 등)에서
// 신호가 들어온다 = 제안→결정→신호→제안 순환에 외부 시작점이 생긴다(콜드 스타트 해소).
//
// EXPIRED 는 제외한다. 무응답 만료는 사용자가 아무 판단을 내리지 않은 것이라 선호로 읽을 수
// 없고, 실측상 카드 대부분이 만료돼(2026-08-04 기준 최근 7일 83/104건) 포함하면 명시적 결정
// 신호가 수집 cap 밖으로 밀려난다.
@Injectable()
export class PreviewDecisionSignalSource implements PreferenceSignalSource {
  readonly name = 'preview_decision';

  constructor(private readonly prisma: PrismaService) {}

  async fetch(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<PreferenceSignal[]> {
    const rows = await this.prisma.previewAction.findMany({
      where: {
        slackUserId: ownerUserId,
        status: { in: ['APPLIED', 'CANCELLED'] },
        createdAt: { gte: new Date(sinceMs) },
        // PREFERENCE_PROFILE 카드는 ProposalDecisionSignalSource 가 이미 읽는다 — 이중 계상 방지.
        kind: { not: PREVIEW_KIND.PREFERENCE_PROFILE },
      },
      orderBy: { createdAt: 'desc' },
      take: ROW_CAP,
    });
    return rows.map((row) => ({
      source: 'preview_decision' as const,
      evidenceRef: `previewAction:${row.id}`,
      observedText: `[${row.status}] ${row.kind} — ${row.previewText.slice(0, TEXT_CAP)}`,
    }));
  }
}
