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
    nextActions: ['옵션 C 전일 plan 참조', 'AGENTS.md 작성'],
    oneLineAchievement: '/review-pr E2E 가능 상태로 진입',
  };

  it('summary / 정량 / 질적 / 개선 / 다음 액션 / 한 줄 모두 출력', () => {
    const text = formatPreviousDailyReviewSection({
      review: base,
      endedAt: new Date('2026-04-23T08:00:00Z'),
    });

    expect(text).toContain('[직전 Work Reviewer 실행 (2026-04-23T08:00:00.000Z)');
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

describe('coerceToDailyReview', () => {
  const valid: DailyReview = {
    summary: 's',
    impact: { quantitative: ['q1'], qualitative: 'q' },
    improvementBeforeAfter: { before: 'b', after: 'a' },
    nextActions: ['n'],
    oneLineAchievement: 'o',
  };

  it('shape 맞으면 그대로 반환', () => {
    expect(coerceToDailyReview(valid)).toEqual(valid);
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
