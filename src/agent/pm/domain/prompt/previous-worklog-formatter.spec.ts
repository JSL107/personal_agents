import { DailyReview } from '../../../work-reviewer/domain/work-reviewer.type';
import {
  coerceToDailyReview,
  formatPreviousDailyReviewSection,
} from './previous-worklog-formatter';

describe('formatPreviousDailyReviewSection', () => {
  const base: DailyReview = {
    summary: 'Phase 4 Code Reviewer 구현',
    impact: {
      quantitative: ['unit test +31건', 'CLI 격리 +3 항목'],
      qualitative: '리뷰 자동화 파이프라인 가동',
    },
    improvementBeforeAfter: {
      before: 'PR 리뷰 수동',
      after: '/review-pr 으로 draft 자동 생성',
    },
    decisions: [],
    risks: [],
    nextActions: ['옵션 C 전일 plan 참조', 'AGENTS.md 작성'],
    oneLineAchievement: '/review-pr E2E 가능 상태로 진입',
  };

  it('summary / 정량 / 질적 / 개선 / 다음 액션 / 한 줄 모두 출력', () => {
    const text = formatPreviousDailyReviewSection({
      review: base,
      endedAt: new Date('2026-04-23T08:00:00Z'),
    });

    expect(text).toContain(
      '[직전 Work Reviewer 실행 (2026-04-23T08:00:00.000Z)',
    );
    expect(text).toContain('- 요약: Phase 4 Code Reviewer 구현');
    expect(text).toContain('- 정량 근거:');
    expect(text).toContain('  - unit test +31건');
    expect(text).toContain('- 질적 영향: 리뷰 자동화 파이프라인 가동');
    expect(text).toContain('- 개선 전: PR 리뷰 수동');
    expect(text).toContain('- 개선 후: /review-pr');
    expect(text).toContain('- 다음 액션 (전일 시점에 식별된):');
    expect(text).toContain('  - 옵션 C 전일 plan 참조');
    expect(text).toContain('- 한 줄 성과: /review-pr E2E');
    expect(text).toContain('이어가야 할 것');
  });

  it('improvementBeforeAfter 가 null 이면 개선 라인 생략', () => {
    const text = formatPreviousDailyReviewSection({
      review: { ...base, improvementBeforeAfter: null },
      endedAt: new Date('2026-04-23T08:00:00Z'),
    });
    expect(text).not.toContain('- 개선 전:');
    expect(text).not.toContain('- 개선 후:');
  });

  it('quantitative / nextActions 가 비어있으면 헤더 생략', () => {
    const text = formatPreviousDailyReviewSection({
      review: {
        ...base,
        impact: { quantitative: [], qualitative: '추정 수준' },
        nextActions: [],
      },
      endedAt: new Date('2026-04-23T08:00:00Z'),
    });
    expect(text).not.toContain('- 정량 근거:');
    expect(text).not.toContain('- 다음 액션');
    expect(text).toContain('- 질적 영향: 추정 수준');
  });
});

describe('formatPreviousDailyReviewSection — 결정사항·위험 3상태', () => {
  const base: DailyReview = {
    summary: 's',
    impact: { quantitative: [], qualitative: 'q' },
    improvementBeforeAfter: null,
    decisions: [],
    risks: [],
    nextActions: [],
    oneLineAchievement: 'o',
  };
  const endedAt = new Date('2026-09-03T10:00:00Z');

  it('빈 배열이면 명시적 부정 한 줄로 적는다', () => {
    const text = formatPreviousDailyReviewSection({ review: base, endedAt });
    expect(text).toContain('- 대표 결정사항: 결재 안건 없음');
    expect(text).toContain('- 위험: 식별된 위험 없음');
  });

  // 미검토를 "없음" 으로 적으면 PM 이 안 본 축을 없다고 읽어 오늘 계획에서 빠뜨린다.
  it('미검토(두 필드 도입 전 회고)면 그 줄을 아예 쓰지 않는다', () => {
    const legacy: DailyReview = { ...base };
    delete legacy.decisions;
    delete legacy.risks;
    const text = formatPreviousDailyReviewSection({ review: legacy, endedAt });
    expect(text).not.toContain('대표 결정사항');
    expect(text).not.toContain('위험');
  });
});

describe('coerceToDailyReview', () => {
  const valid: DailyReview = {
    summary: 's',
    impact: { quantitative: ['q1'], qualitative: 'q' },
    improvementBeforeAfter: { before: 'b', after: 'a' },
    decisions: [],
    risks: [],
    nextActions: ['n'],
    oneLineAchievement: 'o',
  };

  it('shape 맞으면 그대로 반환', () => {
    expect(coerceToDailyReview(valid)).toEqual(valid);
  });

  // decisions / risks 도입 전에 적재된 run output 회귀 — 두 키가 없다고 회고 전체가
  // "이전 worklog 없음" 으로 조용히 사라지면 안 된다.
  it('decisions / risks 키가 없는 예전 output 도 살리되 빈 배열로 채우지 않는다', () => {
    const legacy: Record<string, unknown> = { ...valid };
    delete legacy.decisions;
    delete legacy.risks;
    const coerced = coerceToDailyReview(legacy);
    expect(coerced).not.toBeNull();
    expect(coerced?.decisions).toBeUndefined();
    expect(coerced?.risks).toBeUndefined();
  });

  it('decisions 키가 있는데 형태가 틀리면 거른다', () => {
    expect(
      coerceToDailyReview({ ...valid, decisions: '결재 필요' }),
    ).toBeNull();
  });

  it('improvementBeforeAfter null 도 허용', () => {
    expect(
      coerceToDailyReview({ ...valid, improvementBeforeAfter: null }),
    ).toBeTruthy();
  });

  it('null / 원시값은 null', () => {
    expect(coerceToDailyReview(null)).toBeNull();
    expect(coerceToDailyReview('string')).toBeNull();
    expect(coerceToDailyReview(123)).toBeNull();
  });

  it('summary 누락 시 null', () => {
    const { summary, ...broken } = valid;
    void summary;
    expect(coerceToDailyReview(broken)).toBeNull();
  });

  it('impact.quantitative 가 string[] 이 아니면 null', () => {
    expect(
      coerceToDailyReview({
        ...valid,
        impact: { quantitative: [1], qualitative: 'q' },
      }),
    ).toBeNull();
  });

  it('improvementBeforeAfter 가 잘못된 객체면 null', () => {
    expect(
      coerceToDailyReview({ ...valid, improvementBeforeAfter: 'wrong' }),
    ).toBeNull();
  });
});
