import { CareerMateException } from './career-mate.exception';
import { CareerMateErrorCode } from './career-mate-error-code.enum';
import { PortfolioSyncPlan } from './portfolio-sync-card.type';
import { parsePortfolioSyncPlan } from './portfolio-sync-plan.parse';

const validPlan: PortfolioSyncPlan = {
  version: 1,
  createdAt: '2026-11-04T00:00:00.000Z',
  baseFingerprint: 'fingerprint',
  agentRunId: 42,
  adoption: null,
  cards: [
    {
      slug: 'example-project',
      repo: 'example/project',
      topicIndex: 1,
      anonymized: false,
      siteProjectId: null,
      siteBaseline: null,
      action: 'create',
      memberPrs: ['example/project#1'],
      coverHash: 'hash',
      regenerate: true,
      coverPassed: true,
      coverWasPublic: false,
      sortOrderSent: 1,
      sortOrderOwned: 1,
      body: {},
    },
  ],
  skillGroups: [
    { title: 'Tools', skills: ['Git'], order: 1, highlighted: false },
  ],
  report: {
    skippedTitles: [],
    unnamedKeys: [],
    planViolations: [],
    notInPlan: [],
    unknownTechTerms: [],
    ambiguousAssignments: [],
    coverRetry: [],
    sortOrderKeptByHuman: [],
  },
};

describe('parsePortfolioSyncPlan', () => {
  it('유효한 계획을 그대로 반환한다', () => {
    const raw: unknown = structuredClone(validPlan);
    expect(parsePortfolioSyncPlan(raw)).toEqual(validPlan);
  });

  it.each([
    ['version', { ...validPlan, version: 2 }],
    [
      'cards[0].memberPrs[0]',
      { ...validPlan, cards: [{ ...validPlan.cards[0], memberPrs: [1] }] },
    ],
    [
      'report.coverRetry',
      { ...validPlan, report: { ...validPlan.report, coverRetry: 'retry' } },
    ],
  ])('잘못된 %s를 CONFIG_MISSING으로 거절한다', (field, raw) => {
    try {
      parsePortfolioSyncPlan(raw);
      throw new Error('검증에서 예외가 발생해야 합니다');
    } catch (error) {
      expect(error).toBeInstanceOf(CareerMateException);
      expect((error as CareerMateException).careerMateErrorCode).toBe(
        CareerMateErrorCode.CONFIG_MISSING,
      );
      expect((error as Error).message).toBe(
        `계획 파일 형식이 올바르지 않습니다: ${field}`,
      );
    }
  });
});
