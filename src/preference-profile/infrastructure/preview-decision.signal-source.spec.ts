import { PreviewDecisionSignalSource } from './preview-decision.signal-source';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  kind: 'SESSION_INJECT',
  status: 'APPLIED',
  previewText: '세션 유휴 — PR 마무리 지시',
  appliedAt: new Date('2026-08-01T00:00:00Z'),
  cancelledAt: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ...overrides,
});

const buildPrisma = (rows: unknown[]) => {
  const findMany = jest.fn().mockResolvedValue(rows);
  return { prisma: { previewAction: { findMany } } as never, findMany };
};

describe('PreviewDecisionSignalSource', () => {
  it('APPLIED/CANCELLED preview 를 PreferenceSignal 로 매핑한다', async () => {
    const { prisma } = buildPrisma([
      makeRow({ id: 'p-1', kind: 'SESSION_INJECT', status: 'APPLIED' }),
      makeRow({
        id: 'p-2',
        kind: 'EVENING_BLOG_PUBLISH',
        status: 'CANCELLED',
        previewText: '블로그 발행 후보',
        appliedAt: null,
        cancelledAt: new Date('2026-07-31T00:00:00Z'),
      }),
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

  it('7일 창을 생성 시각이 아니라 결정 시각(appliedAt/cancelledAt)으로 자른다', async () => {
    const { prisma, findMany } = buildPrisma([]);
    const source = new PreviewDecisionSignalSource(prisma);
    const sinceMs = 1_700_000_000_000;
    await source.fetch('U9', sinceMs);

    const where = findMany.mock.calls[0][0].where;
    expect(where.slackUserId).toBe('U9');
    // createdAt 으로 자르면 창 직전 생성 + 창 안 결정 카드가 어느 회차에서도 안 잡힌다.
    expect(where.createdAt).toBeUndefined();
    expect(where.OR).toEqual([
      { status: 'APPLIED', appliedAt: { gte: new Date(sinceMs) } },
      { status: 'CANCELLED', cancelledAt: { gte: new Date(sinceMs) } },
    ]);
  });

  it('이중 계상·의미 반전 kind 를 제외한다', async () => {
    const { prisma, findMany } = buildPrisma([]);
    const source = new PreviewDecisionSignalSource(prisma);
    await source.fetch('U1', 0);

    // PREFERENCE_PROFILE: ProposalDecisionSignalSource 담당.
    // CAREER_JD_GAP_BLOG: 주제 선택 성공도 cancel 로 소비돼 CANCELLED 가 거절을 뜻하지 않음.
    expect(findMany.mock.calls[0][0].where.kind).toEqual({
      notIn: ['PREFERENCE_PROFILE', 'CAREER_JD_GAP_BLOG'],
    });
  });

  it('결정 시각 내림차순으로 정렬한다 (생성 순서와 어긋나도)', async () => {
    // 먼저 생성됐지만 나중에 결정된 카드가 앞에 와야 한다.
    const { prisma } = buildPrisma([
      makeRow({
        id: 'late-created',
        createdAt: new Date('2026-08-03T00:00:00Z'),
        appliedAt: new Date('2026-08-03T01:00:00Z'),
      }),
      makeRow({
        id: 'early-created-late-decided',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        appliedAt: null,
        cancelledAt: new Date('2026-08-04T00:00:00Z'),
        status: 'CANCELLED',
      }),
    ]);
    const source = new PreviewDecisionSignalSource(prisma);
    const signals = await source.fetch('U1', 0);

    expect(signals.map((signal) => signal.evidenceRef)).toEqual([
      'previewAction:early-created-late-decided',
      'previewAction:late-created',
    ]);
  });

  it('결정 시각이 비어 있으면 createdAt 으로 방어한다', async () => {
    const { prisma } = buildPrisma([
      makeRow({ id: 'no-decided-at', appliedAt: null, cancelledAt: null }),
    ]);
    const source = new PreviewDecisionSignalSource(prisma);
    const signals = await source.fetch('U1', 0);
    expect(signals).toHaveLength(1);
  });

  it('preview_text 가 길면 200자로 자른다', async () => {
    const { prisma } = buildPrisma([
      makeRow({ id: 'p-3', previewText: '가'.repeat(500) }),
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
