import { ScoreRecommendationsResult } from '../application/score-recommendations.usecase';
import { formatPaperScoreReport } from './paper-score.formatter';

const RESULT: ScoreRecommendationsResult = {
  asOf: new Date('2026-08-13T00:00:00.000Z'),
  from: null,
  persisted: true,
  evaluationBenchmarkMissing: false,
  accounts: [
    {
      accountId: 7,
      accountName: 'LONG_TERM',
      strategy: 'LONG_TERM',
      ruleVersions: [2],
      unknownRuleVersionCount: 0,
      exitBands: ['+10/-5'],
      bandlessSellCount: 0,
      score: {
        strategy: 'LONG_TERM',
        recommendationCount: 6,
        closedCount: 4,
        openCount: 1,
        expiredCount: 1,
        hitCount: 3,
        hitRate: '0.75',
        meanReturnRate: '0.1234',
        medianReturnRate: '0.1',
        maximumLoss: '-0.055',
        averageHoldingDays: '12.5',
        anomalyCount: 2,
        realizedPnlMismatchCount: 1,
      },
      meanExcessReturnRate: '0.0234',
      meanShadowReturnRate: '0.08',
      evaluationBenchmarkMissing: false,
      portfolio: {
        snapshotCount: 8,
        accountReturnRate: '0.15',
        maximumDrawdown: '-0.04',
        turnoverRate: '1.25',
        cumulativeCost: '1234.5',
      },
      classifications: { closed: 4, open: 1, expired: 1, anomaly: 0 },
      exclusions: {
        expired: 1,
        benchmarkUnavailable: 2,
        shadowUnavailable: 3,
        shadowNotDue: 0,
        anomaly: 2,
        realizedPnlMismatch: 1,
      },
    },
  ],
  classifications: { closed: 4, open: 1, expired: 1, anomaly: 0 },
  exclusions: {
    expired: 1,
    benchmarkUnavailable: 2,
    shadowUnavailable: 3,
    shadowNotDue: 0,
    anomaly: 2,
    realizedPnlMismatch: 1,
  },
};

describe('formatPaperScoreReport', () => {
  it('비율 문자열을 100배 한 퍼센트로 표시하고 전략·포트폴리오 지표를 모두 출력한다', () => {
    const text = formatPaperScoreReport(RESULT);

    expect(text).toContain('추천 6건 · 체결 5건(청산 4·보유 1) · 미체결 1건');
    expect(text).toContain('적중 3/4 (75%)');
    expect(text).toContain('평균 +12.34% · 중앙값 +10% · 최대 손실 -5.5%');
    expect(text).toContain(
      '평균 보유 12.5일 · 평균 초과 +2.34% · 그림자 평균 +8%',
    );
    expect(text).toContain('계좌 수익률 +15% · MDD -4% · 회전율 1.25배');
    expect(text).toContain('누적 비용 1,234.5원 · 실제 스냅샷 8건');
    expect(text).toContain('*LONG_TERM* · 규칙 v2');
  });

  // 저장하지 않은 회차를 조용히 넘기면, 손으로 과거를 재채점한 숫자를 원장에 있는 성적으로
  // 착각하게 된다.
  it('원장에 남기지 않은 회차는 그 사실과 이유를 함께 적는다', () => {
    const kept = formatPaperScoreReport(RESULT);
    const dropped = formatPaperScoreReport({ ...RESULT, persisted: false });

    expect(kept).not.toContain('원장에 저장하지 않았습니다');
    expect(dropped).toContain('이 회차는 원장에 저장하지 않았습니다');
    expect(dropped).toContain('과거 기준일 재채점이거나 구간 집계');
  });

  it('규칙 버전이 섞였거나 기록되지 않은 집계를 그대로 드러낸다', () => {
    const render = (
      ruleVersions: number[],
      unknownRuleVersionCount: number,
    ): string =>
      formatPaperScoreReport({
        ...RESULT,
        accounts: [
          { ...RESULT.accounts[0], ruleVersions, unknownRuleVersionCount },
        ],
      });

    expect(render([2, 3], 0)).toContain('*LONG_TERM* · 규칙 v2·v3 혼합');
    // 알려진 버전만 세면 섞인 표본이 순수한 v2 성적처럼 보인다 — 미기록도 함께 적는다.
    expect(render([2], 3)).toContain('*LONG_TERM* · 규칙 v2 + 미기록 3건');
    expect(render([], 3)).toContain('*LONG_TERM* · 규칙 미기록 3건');
    // 추천이 아예 없는 계좌를 "미기록" 으로 적으면 없는 표본이 있는 것처럼 읽힌다.
    expect(render([], 0)).toContain('*LONG_TERM* · 규칙 -');
  });

  it('청산 밴드가 섞였거나 밴드 밖에서 팔린 집계를 그대로 드러낸다', () => {
    const render = (exitBands: string[], bandlessSellCount: number): string =>
      formatPaperScoreReport({
        ...RESULT,
        accounts: [{ ...RESULT.accounts[0], exitBands, bandlessSellCount }],
      });

    expect(render(['+2/-0.2', '+10/-5'], 0)).toContain(
      '밴드 +2/-0.2 · +10/-5 혼합',
    );
    // 모델이 고른 매도는 밴드 성적의 분모가 아니다 — 건수로 갈라 적는다.
    expect(render(['+10/-5'], 1)).toContain('밴드 +10/-5 + 밴드 외 1건');
    expect(render([], 2)).toContain('밴드 - + 밴드 외 2건');
    // 매도가 아예 없는 계좌를 "밴드 외" 로 적으면 없는 표본이 있는 것처럼 읽힌다.
    expect(render([], 0)).toContain('밴드 -');
  });

  it('모든 제외 사유·분류·소표본 경고와 필수 해석 한계를 출력한다', () => {
    const text = formatPaperScoreReport(RESULT);

    expect(text).toContain('청산 4 · 보유 1 · 미체결 1 · 이상치 0');
    expect(text).toContain(
      '미체결 1 · 벤치마크 결손 2 · 그림자 미산출 3 · 이상치 2 · realizedPnl 불일치 1',
    );
    expect(text).toContain('청산 표본 5건 미만');
    expect(text).toContain('실제는 다음 거래일 시가, 그림자는 같은 날 종가');
    expect(text).toContain('진입 기준 차이');
    expect(text).toContain('현재 저장 close는 조정 계열');
    expect(text).toContain('수집 방식 변경 시 그림자 계산을 재검토');
  });

  it('빈 표본도 생략하지 않고 산출 불가와 0건을 보고한다', () => {
    const text = formatPaperScoreReport({
      ...RESULT,
      accounts: [
        {
          ...RESULT.accounts[0],
          score: {
            ...RESULT.accounts[0].score,
            recommendationCount: 0,
            closedCount: 0,
            openCount: 0,
            expiredCount: 0,
            hitCount: 0,
            hitRate: null,
            meanReturnRate: null,
            medianReturnRate: null,
            maximumLoss: null,
            averageHoldingDays: null,
          },
          meanExcessReturnRate: null,
          meanShadowReturnRate: null,
          evaluationBenchmarkMissing: false,
          portfolio: {
            snapshotCount: 0,
            accountReturnRate: null,
            maximumDrawdown: null,
            turnoverRate: null,
            cumulativeCost: '0',
          },
        },
      ],
      classifications: { closed: 0, open: 0, expired: 0, anomaly: 0 },
      exclusions: {
        expired: 0,
        benchmarkUnavailable: 0,
        shadowUnavailable: 0,
        shadowNotDue: 0,
        anomaly: 0,
        realizedPnlMismatch: 0,
      },
    });

    expect(text).toContain('추천 0건');
    expect(text).toContain('적중 0/0 (-)');
    expect(text).toContain('평균 - · 중앙값 - · 최대 손실 -');
  });
});
