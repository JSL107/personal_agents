import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import {
  PoEvalCareerlogApplier,
  PoEvalCareerlogPayload,
} from './po-eval-careerlog.applier';

const buildFullPayload = (
  overrides: Partial<PoEvalCareerlogPayload> = {},
): PoEvalCareerlogPayload => ({
  notionPageId: 'page-id-123',
  period: '2026-05-28',
  careerLog: {
    schemaVersion: 1,
    period: '2026-05-28',
    achievements: {
      quantitative: ['PR 3건 머지', 'BE-Schema 2건 적용'],
      qualitative: ['Router 도입 완료'],
    },
    technologies: ['NestJS', 'Prisma'],
    impact: 'V3 phase loop 의 chain 가시화로 사용자 회고 정확도 향상.',
  },
  ...overrides,
});

const buildPreview = (payload: unknown): PreviewAction => ({
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PO_EVAL_CAREERLOG,
  payload,
  status: 'PENDING',
  previewText: '',
  responseUrl: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
});

describe('PoEvalCareerlogApplier', () => {
  const mockNotion = { appendBlocks: jest.fn() };
  const applier = new PoEvalCareerlogApplier(mockNotion as never);

  beforeEach(() => jest.clearAllMocks());

  it('정상 payload — heading + 정량 성과 + 정성 성과 + 기술 스택 + impact + divider 순으로 append', async () => {
    const payload = buildFullPayload();

    const result = await applier.apply(buildPreview(payload));

    expect(mockNotion.appendBlocks).toHaveBeenCalledTimes(1);
    const call = mockNotion.appendBlocks.mock.calls[0][0];
    expect(call.pageId).toBe('page-id-123');
    const types = call.blocks.map((b: { type: string }) => b.type);
    expect(types).toEqual([
      'heading',
      'subheading',
      'bullet',
      'bullet',
      'subheading',
      'bullet',
      'paragraph',
      'paragraph',
      'divider',
    ]);
    expect(call.blocks[0].text).toContain('careerLog — 2026-05-28');
    expect(result.message).toContain('Notion 페이지에 careerLog');
    expect(result.message).toContain('2026-05-28');
  });

  it('정량/정성/기술 모두 비어 있으면 heading + divider 만', async () => {
    const payload = buildFullPayload({
      careerLog: {
        schemaVersion: 1,
        period: '2026-W22',
        achievements: { quantitative: [], qualitative: [] },
        technologies: [],
        impact: '',
      },
      period: '2026-W22',
    });

    await applier.apply(buildPreview(payload));

    const call = mockNotion.appendBlocks.mock.calls[0][0];
    const types = call.blocks.map((b: { type: string }) => b.type);
    expect(types).toEqual(['heading', 'divider']);
    expect(call.blocks[0].text).toContain('2026-W22');
  });

  it('payload 가 객체 아니면 명시 에러', async () => {
    await expect(applier.apply(buildPreview('not-object'))).rejects.toThrow(
      /객체가 아닙니다/,
    );
    expect(mockNotion.appendBlocks).not.toHaveBeenCalled();
  });

  it('notionPageId 누락 시 명시 에러', async () => {
    const broken = { ...buildFullPayload(), notionPageId: '' };
    await expect(applier.apply(buildPreview(broken))).rejects.toThrow(
      /notionPageId/,
    );
    expect(mockNotion.appendBlocks).not.toHaveBeenCalled();
  });

  it('careerLog 누락 시 명시 에러', async () => {
    const broken = {
      notionPageId: 'p',
      period: '2026-05-28',
      careerLog: null,
    };
    await expect(applier.apply(buildPreview(broken))).rejects.toThrow(
      /careerLog/,
    );
  });

  it('careerLog 내부 achievements 가 { quantitative, qualitative } 형태 아니면 명시 에러', async () => {
    const broken = {
      notionPageId: 'p',
      period: '2026-05-28',
      careerLog: { schemaVersion: 1, period: 'x' },
    };
    await expect(applier.apply(buildPreview(broken))).rejects.toThrow(
      /achievements/,
    );
  });

  it('careerLog.technologies 가 array 아니면 명시 에러', async () => {
    const broken = {
      notionPageId: 'p',
      period: '2026-05-28',
      careerLog: {
        schemaVersion: 1,
        period: '2026-05-28',
        achievements: { quantitative: [], qualitative: [] },
        technologies: 'not-array',
        impact: '',
      },
    };
    await expect(applier.apply(buildPreview(broken))).rejects.toThrow(
      /technologies/,
    );
  });

  it('careerLog.impact 가 string 아니면 명시 에러', async () => {
    const broken = {
      notionPageId: 'p',
      period: '2026-05-28',
      careerLog: {
        schemaVersion: 1,
        period: '2026-05-28',
        achievements: { quantitative: [], qualitative: [] },
        technologies: [],
        impact: 123,
      },
    };
    await expect(applier.apply(buildPreview(broken))).rejects.toThrow(/impact/);
  });

  it('kind 는 PREVIEW_KIND.PO_EVAL_CAREERLOG 와 일치 — ApplyPreviewUsecase 의 strategy lookup 보장', () => {
    expect(applier.kind).toBe(PREVIEW_KIND.PO_EVAL_CAREERLOG);
  });
});
