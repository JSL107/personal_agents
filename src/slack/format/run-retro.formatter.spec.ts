import { RunAnomaly } from '../../autopilot/domain/run-retro.anomaly';
import { formatRunRetro } from './run-retro.formatter';

describe('formatRunRetro', () => {
  it('이상 0건 → 1줄 하트비트(총 건수 무장애)', () => {
    const text = formatRunRetro(
      [
        {
          agentType: 'PM',
          total: 11,
          failed: 0,
          failRate: 0,
          avgDurationMs: 40_000,
        },
        {
          agentType: 'CEO',
          total: 6,
          failed: 0,
          failRate: 0,
          avgDurationMs: 35_000,
        },
      ],
      [],
      '2026-07-06',
    );
    expect(text).toContain('✅');
    expect(text).toContain('이상 없음');
    expect(text).toContain('17건');
    expect(text).not.toContain('•');
  });

  it('경보: 해당 항목만 + 개수 헤더 + kind별 힌트', () => {
    const anomalies: RunAnomaly[] = [
      { agentType: 'PM', kind: 'LATENCY_CEILING', detail: '평균 201.4s' },
      {
        agentType: 'PO_EVAL',
        kind: 'AGENT_DISAPPEARED',
        detail: '이번주 0건 (지난주 10건)',
      },
    ];
    const text = formatRunRetro(
      [
        {
          agentType: 'PM',
          total: 5,
          failed: 0,
          failRate: 0,
          avgDurationMs: 201_400,
        },
      ],
      anomalies,
      '2026-07-06',
    );
    expect(text).toContain('🚨');
    expect(text).toContain('이상 2건');
    expect(text).toContain('PM: 평균 201.4s — 인증/쿼터 소진 의심');
    expect(text).toContain(
      'PO_EVAL: 이번주 0건 (지난주 10건) — cron 사망 의심',
    );
  });

  it('전체 침묵: TOTAL_SILENCE 헤더 + 점검 힌트', () => {
    const anomalies: RunAnomaly[] = [
      {
        agentType: null,
        kind: 'TOTAL_SILENCE',
        detail: '이번주 실행 0건 (지난주 45건)',
      },
    ];
    const text = formatRunRetro([], anomalies, '2026-07-06');
    expect(text).toContain('전체 침묵');
    expect(text).toContain(
      '이번주 실행 0건 (지난주 45건) — 시스템 전체 점검 필요',
    );
  });

  // 형식 경보는 품질로 읽히면 안 된다 — 힌트도 "형식" 을 말한다(설계 §6).
  it('형식 준수율 경보: 형식 힌트를 붙이고 "계약 점수" 라는 말을 쓰지 않는다', () => {
    const anomalies: RunAnomaly[] = [
      {
        agentType: 'PM',
        kind: 'CONTRACT_SCORE',
        detail:
          '형식 준수율 30% (10건 평균, 하한 50% · 필수 필드 존재 여부만 검사함) · 품질: 판정 없음',
      },
    ];
    const text = formatRunRetro([], anomalies, '2026-07-06');

    expect(text).toContain(
      '• 📋 PM: 형식 준수율 30% (10건 평균, 하한 50% · 필수 필드 존재 여부만 검사함) · 품질: 판정 없음 — 산출물 형식이 계약과 어긋남',
    );
    expect(text).not.toContain('계약 점수');
  });
});
