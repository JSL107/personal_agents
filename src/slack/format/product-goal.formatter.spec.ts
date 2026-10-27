import {
  ProductGoalDraft,
  ProductGoalRecord,
} from '../../agent/po-shadow/domain/product-goal';
import {
  formatGoalCreatePreview,
  formatGoalList,
} from './product-goal.formatter';

const goal = (
  overrides: Partial<ProductGoalRecord> = {},
): ProductGoalRecord => ({
  id: 1,
  slackUserId: 'U1',
  kind: 'TASK',
  title: '운영 배포',
  why: null,
  successCriterion: '배포 완료',
  keywords: ['배포'],
  dueDate: null,
  closedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
});

const draft = (
  overrides: Partial<ProductGoalDraft> = {},
): ProductGoalDraft => ({
  kind: 'TASK',
  title: '운영 배포',
  why: null,
  successCriterion: '배포 완료',
  keywords: ['배포'],
  dueDate: null,
  ...overrides,
});

describe('formatGoalList', () => {
  it('방향만 있으면 이유를 보여 주고 기준·키워드는 숨긴다', () => {
    const text = formatGoalList([
      goal({
        kind: 'DIRECTION',
        title: '개인비서',
        why: '업무를 줄이기 위해',
        successCriterion: null,
        keywords: [],
      }),
    ]);
    expect(text).toContain('숙제 0/3 · 방향 1/2');
    expect(text).toContain('• 🧭 *개인비서* (방향)\n  왜: 업무를 줄이기 위해');
    expect(text).not.toContain('달성 기준');
    expect(text).not.toContain('키워드:');
  });

  it('숙제만 있으면 기존 기준·키워드를 표시한다', () => {
    const text = formatGoalList([goal()]);
    expect(text).toContain('숙제 1/3 · 방향 0/2');
    expect(text).toContain('달성 기준: 배포 완료');
    expect(text).toContain('키워드: 배포');
  });

  it('섞인 목록은 종류별 수를 센다', () => {
    const text = formatGoalList([
      goal(),
      goal({
        id: 2,
        kind: 'DIRECTION',
        title: '나만의 비서',
        successCriterion: null,
      }),
    ]);
    expect(text).toContain('숙제 1/3 · 방향 1/2');
    expect(text).toContain('• 🧭 *나만의 비서* (방향)');
  });

  it('구형 데이터의 기준 null도 예외 없이 표시한다', () => {
    expect(() =>
      formatGoalList([goal({ successCriterion: null })]),
    ).not.toThrow();
    expect(formatGoalList([goal({ successCriterion: null })])).not.toContain(
      '달성 기준:',
    );
  });
});

describe('formatGoalCreatePreview', () => {
  it('방향 카드에는 기준·키워드 줄을 넣지 않는다', () => {
    const text = formatGoalCreatePreview(
      draft({
        kind: 'DIRECTION',
        why: '시간을 아끼기 위해',
        successCriterion: null,
        keywords: [],
      }),
      { conversation: true },
    );
    expect(text).toContain('• 종류: 🧭 방향');
    expect(text).toContain('• 왜: 시간을 아끼기 위해');
    expect(text).not.toContain('달성 기준:');
    expect(text).not.toContain('키워드:');
    expect(text).toContain('종류나 내용을 바꾸려면');
  });

  it('다른 목표 제목을 카드에만 안내한다', () => {
    const text = formatGoalCreatePreview(draft(), {
      conversation: true,
      otherGoalTitles: ['문서 정리', '배포 점검'],
    });
    expect(text).toContain('• 종류: ✅ 숙제');
    expect(text).toContain(
      '함께 말한 목표: 문서 정리, 배포 점검 — 승인 뒤 다시 말해 주세요.',
    );
  });
});
