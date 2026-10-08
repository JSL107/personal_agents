import {
  findGoalDeclarationProblem,
  isMeasurableCriterion,
  isProductGoalPreviewPayload,
  matchGoalsByTitle,
  MAX_ACTIVE_PRODUCT_GOALS,
  parseProductGoalCommand,
  ProductGoalDraft,
  ProductGoalRecord,
} from './product-goal';

const today = { year: 2026, month: 10, day: 8 };

const draft = (
  overrides: Partial<ProductGoalDraft> = {},
): ProductGoalDraft => ({
  title: '보존기간 파일 파기',
  successCriterion: 'sbe-api-v5 운영 배포 완료',
  keywords: ['보존기간', '파기'],
  dueDate: null,
  ...overrides,
});

const goal = (id: number, title: string): ProductGoalRecord => ({
  id,
  slackUserId: 'U1',
  title,
  successCriterion: '운영 배포 완료',
  keywords: [title],
  dueDate: null,
  closedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
});

describe('parseProductGoalCommand', () => {
  it('선언에서 제목·달성 기준·기한을 가른다', () => {
    expect(
      parseProductGoalCommand(
        '<@U0> 이번 분기 목표는 보존기간 파일 파기, 달성 기준은 sbe-api-v5 운영 배포 완료, 기한 12월 31일',
        today,
      ),
    ).toEqual({
      kind: 'DECLARE',
      draft: {
        title: '보존기간 파일 파기',
        successCriterion: 'sbe-api-v5 운영 배포 완료',
        // 키워드를 안 주면 제목 낱말로 채운다. 어디에나 붙는 낱말("기능"·"출시" 등)은 뺀다.
        keywords: ['보존기간', '파일', '파기'],
        dueDate: '2026-12-31',
      },
      dueDateUnreadable: false,
    });
  });

  it('키워드를 주면 그것을 쓴다', () => {
    const command = parseProductGoalCommand(
      '이번 분기 목표는 업로드 안정화, 달성 기준은 실패율 1% 이하, 키워드 upload, 업로드',
      today,
    );
    expect(command).toMatchObject({
      kind: 'DECLARE',
      draft: { keywords: ['upload', '업로드'], dueDate: null },
    });
  });

  it('쌍점 선언도 받는다 — 놓치면 PO 검토 문장으로 흘러 모델이 불린다', () => {
    expect(
      parseProductGoalCommand(
        '이번 분기 목표: 업로드 안정화, 달성 기준: 실패율 1% 이하',
        today,
      ),
    ).toMatchObject({
      kind: 'DECLARE',
      draft: { title: '업로드 안정화', successCriterion: '실패율 1% 이하' },
    });
  });

  it('달성 기준이 없으면 null 로 남긴다 — 저장 여부는 판정 함수가 정한다', () => {
    expect(
      parseProductGoalCommand('이번 분기 목표는 업로드 안정화', today),
    ).toMatchObject({ kind: 'DECLARE', draft: { successCriterion: null } });
  });

  it('기한을 날짜로 못 읽으면 표시한다 — 조용히 기한 없음으로 두지 않는다', () => {
    expect(
      parseProductGoalCommand(
        '이번 분기 목표는 업로드 안정화, 달성 기준은 실패율 1% 이하, 기한 연말쯤',
        today,
      ),
    ).toMatchObject({ kind: 'DECLARE', dueDateUnreadable: true });
  });

  it.each([
    ['목표 보여줘', { kind: 'LIST' }],
    ['지금 목표 뭐야?', { kind: 'LIST' }],
    [
      '보존기간 파일 파기 목표 닫아줘',
      { kind: 'CLOSE', titleQuery: '보존기간 파일 파기' },
    ],
    ['"업로드" 목표를 종료해줘', { kind: 'CLOSE', titleQuery: '업로드' }],
    ['오늘 계획 검토해줘', { kind: 'NONE' }],
    ['', { kind: 'NONE' }],
  ])('%s → %o', (text, expected) => {
    expect(parseProductGoalCommand(text, today)).toEqual(expected);
  });
});

// 선언 초안과 겹치지 않는 제목의 활성 목표 n 개.
const titled = (count: number): { title: string }[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `다른 목표 ${index}`,
  }));

describe('findGoalDeclarationProblem', () => {
  // 정책 3 — 달성 기준 없는 목표는 저장하지 않는다.
  it.each([
    [null, 'MISSING_CRITERION'],
    ['   ', 'MISSING_CRITERION'],
    ['개선하기', 'UNMEASURABLE_CRITERION'],
    ['업로드 품질 향상', 'UNMEASURABLE_CRITERION'],
  ])('달성 기준 %p → %s', (successCriterion, expected) => {
    expect(
      findGoalDeclarationProblem({
        draft: draft({ successCriterion }),
        activeGoals: [],
      }),
    ).toBe(expected);
  });

  // 정책 4 — 활성 목표는 상수 하나로 막는다.
  it('활성 목표가 상한에 닿으면 저장하지 않는다', () => {
    expect(
      findGoalDeclarationProblem({
        draft: draft(),
        activeGoals: titled(MAX_ACTIVE_PRODUCT_GOALS),
      }),
    ).toBe('ACTIVE_LIMIT_REACHED');
    expect(
      findGoalDeclarationProblem({
        draft: draft(),
        activeGoals: titled(MAX_ACTIVE_PRODUCT_GOALS - 1),
      }),
    ).toBeNull();
  });

  // 같은 제목이 둘이면 닫기가 모호 거절돼 어떤 말로도 닫을 수 없다(#773 리뷰).
  it('정규화한 제목이 같은 활성 목표가 있으면 저장하지 않는다', () => {
    expect(
      findGoalDeclarationProblem({
        draft: draft({ title: '보존기간  파일 파기' }),
        activeGoals: [{ title: '"보존기간 파일 파기"' }],
      }),
    ).toBe('DUPLICATE_TITLE');
    expect(
      findGoalDeclarationProblem({
        draft: draft({ title: '보존기간 파일 파기 2차' }),
        activeGoals: [{ title: '보존기간 파일 파기' }],
      }),
    ).toBeNull();
  });

  it('제목·키워드·기한 문제를 가른다', () => {
    expect(
      findGoalDeclarationProblem({
        draft: draft({ title: '' }),
        activeGoals: [],
      }),
    ).toBe('MISSING_TITLE');
    expect(
      findGoalDeclarationProblem({
        draft: draft({ keywords: [] }),
        activeGoals: [],
      }),
    ).toBe('MISSING_KEYWORDS');
    expect(
      findGoalDeclarationProblem({
        draft: draft(),
        activeGoals: [],
        dueDateUnreadable: true,
      }),
    ).toBe('UNREADABLE_DUE_DATE');
  });
});

describe('isMeasurableCriterion', () => {
  it.each([
    ['p95 응답 300ms 이하', true],
    ['운영 배포 완료', true],
    ['실패율 1%', true],
    ['개선하기', false],
    ['더 좋게', false],
  ])('%s → %s', (criterion, expected) => {
    expect(isMeasurableCriterion(criterion)).toBe(expected);
  });
});

describe('matchGoalsByTitle', () => {
  const goals = [goal(1, '파기'), goal(2, '파기 2차'), goal(3, '업로드')];

  it('정확히 같은 제목이 있으면 그것만 고른다', () => {
    expect(matchGoalsByTitle(goals, '파기').map((item) => item.id)).toEqual([
      1,
    ]);
  });

  it('부분 일치가 여럿이면 모두 돌려준다', () => {
    expect(matchGoalsByTitle(goals, '파').map((item) => item.id)).toEqual([
      1, 2,
    ]);
  });

  it('빈 질의는 아무것도 고르지 않는다', () => {
    expect(matchGoalsByTitle(goals, '')).toEqual([]);
  });
});

describe('isProductGoalPreviewPayload', () => {
  it('CREATE·CLOSE 형태를 통과시키고 나머지는 거른다', () => {
    expect(
      isProductGoalPreviewPayload({ action: 'CREATE', draft: draft() }),
    ).toBe(true);
    expect(
      isProductGoalPreviewPayload({ action: 'CLOSE', goalId: 1, title: 'a' }),
    ).toBe(true);
    expect(
      isProductGoalPreviewPayload({
        action: 'CREATE',
        draft: draft({ dueDate: '12월 31일' }),
      }),
    ).toBe(false);
    expect(isProductGoalPreviewPayload({ action: 'DROP' })).toBe(false);
  });
});
