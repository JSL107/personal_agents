import { PreviewDecisionSignalSource } from './preview-decision.signal-source';

const buildPrisma = (rows: unknown[]) => {
  const findMany = jest.fn().mockResolvedValue(rows);
  return { prisma: { previewAction: { findMany } } as never, findMany };
};

describe('PreviewDecisionSignalSource', () => {
  it('APPLIED/CANCELLED preview 를 PreferenceSignal 로 매핑한다', async () => {
    const { prisma } = buildPrisma([
      {
        id: 'p-1',
        kind: 'SESSION_INJECT',
        status: 'APPLIED',
        previewText: '세션 유휴 — PR 마무리 지시',
      },
      {
        id: 'p-2',
        kind: 'EVENING_BLOG_PUBLISH',
        status: 'CANCELLED',
        previewText: '블로그 발행 후보',
      },
    ]);
    const source = new PreviewDecisionSignalSource(prisma);
    const signals = await source.fetch('U1', Date.now() - 86400_000);

    expect(signals).toEqual([
      {
        source: 'preview_decision',
        evidenceRef: 'previewAction:p-1',
        observedText: '[APPLIED] SESSION_INJECT — 세션 유휴 — PR 마무리 지시',
      },
      {
        source: 'preview_decision',
        evidenceRef: 'previewAction:p-2',
        observedText: '[CANCELLED] EVENING_BLOG_PUBLISH — 블로그 발행 후보',
      },
    ]);
  });

  it('결정 상태·소유자·기간 + PREFERENCE_PROFILE 제외로 조회한다', async () => {
    const { prisma, findMany } = buildPrisma([]);
    const source = new PreviewDecisionSignalSource(prisma);
    const sinceMs = 1_700_000_000_000;
    await source.fetch('U9', sinceMs);

    const where = findMany.mock.calls[0][0].where;
    expect(where.slackUserId).toBe('U9');
    expect(where.status).toEqual({ in: ['APPLIED', 'CANCELLED'] });
    expect(where.createdAt).toEqual({ gte: new Date(sinceMs) });
    // 선호 카드 결정은 ProposalDecisionSignalSource 담당 — 이중 계상 방지.
    expect(where.kind).toEqual({ not: 'PREFERENCE_PROFILE' });
  });

  it('preview_text 가 길면 200자로 자른다', async () => {
    const { prisma } = buildPrisma([
      {
        id: 'p-3',
        kind: 'SESSION_INJECT',
        status: 'APPLIED',
        previewText: '가'.repeat(500),
      },
    ]);
    const source = new PreviewDecisionSignalSource(prisma);
    const signals = await source.fetch('U1', 0);

    expect(signals[0].observedText).toBe(
      `[APPLIED] SESSION_INJECT — ${'가'.repeat(200)}`,
    );
  });

  it('결정 이력이 없으면 빈 배열을 반환한다', async () => {
    const { prisma } = buildPrisma([]);
    const source = new PreviewDecisionSignalSource(prisma);
    expect(await source.fetch('U1', 0)).toEqual([]);
  });
});
