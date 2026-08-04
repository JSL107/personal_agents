import { Injectable } from '@nestjs/common';

import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { PrismaService } from '../../prisma/prisma.service';
import { PreferenceSignalSource } from '../domain/port/preference-signal-source.port';
import { PreferenceSignal } from '../domain/preference-signal.type';

const TEXT_CAP = 200;
const ROW_CAP = 50;
// 조회 상한 — 결정 시각 정렬을 DB 에서 할 수 없어(appliedAt/cancelledAt 두 컬럼 분리 +
// COALESCE raw SQL 금지) 창 안의 결정을 넉넉히 받아 코드에서 정렬한 뒤 ROW_CAP 으로 자른다.
// ROW_CAP 을 조회에 걸면 "생성은 오래됐지만 최근에 결정된" 카드가 정렬 전에 잘려나간다.
// 7일 창 + owner 단일이라 실측 규모는 결정 22건 / 전체 카드 108건(2026-08-04) — 500 은 여유.
// 이 상한을 넘는 주가 생기면 그때는 결정 시각 인덱스를 별도로 두는 편이 낫다.
const FETCH_LIMIT = 500;

const EXCLUDED_KINDS = [
  // ProposalDecisionSignalSource 가 이미 읽는다 — 이중 계상 방지.
  PREVIEW_KIND.PREFERENCE_PROFILE,
  // applier 가 없어 "주제 선택 성공" 도 cancel 로 preview 를 소비한다
  // (router-message.handler.ts:463 "성공 — 이제 preview 소비"). CANCELLED 가 거절을
  // 뜻하지 않으므로 그대로 읽으면 사용자의 선택을 반대 선호로 학습한다.
  PREVIEW_KIND.CAREER_JD_GAP_BLOG,
];

// 결정 시각 — status 에 따라 채워지는 컬럼이 다르다(포트 계약: transition 이 status 에 맞춰 채움).
// 실측(2026-08-04)상 APPLIED 15/15 · CANCELLED 12/12 모두 채워져 있으나 스키마가 nullable 이라
// createdAt 으로 방어한다.
const decidedAtMs = (row: {
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}): number => (row.appliedAt ?? row.cancelledAt ?? row.createdAt).getTime();

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
    const since = new Date(sinceMs);
    const rows = await this.prisma.previewAction.findMany({
      where: {
        slackUserId: ownerUserId,
        kind: { notIn: EXCLUDED_KINDS },
        // 창은 생성 시각이 아니라 결정 시각 기준. createdAt 으로 자르면 카드가 창 직전에
        // 생성되고 창 안에서 결정된 경우 어느 회차에서도 잡히지 않는다 — 지난 회차에는 아직
        // PENDING 이라 status 필터에 걸리고, 이번 회차에는 createdAt 이 창 밖이다.
        OR: [
          { status: 'APPLIED', appliedAt: { gte: since } },
          { status: 'CANCELLED', cancelledAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: FETCH_LIMIT,
    });
    // 결정 시각 desc 로 정렬한 뒤 자른다 — 순서를 뒤집으면(조회에 ROW_CAP) 생성이 오래된
    // 최신 결정이 정렬 전에 탈락해 "결정 시각 기준 수집" 이 깨진다.
    return rows
      .sort((a, b) => decidedAtMs(b) - decidedAtMs(a))
      .slice(0, ROW_CAP)
      .map((row) => ({
        source: 'preview_decision' as const,
        evidenceRef: `previewAction:${row.id}`,
        observedText: `[${row.status}] ${row.kind} — ${row.previewText.slice(0, TEXT_CAP)}`,
      }));
  }
}
