import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { EveningCareerReflectApplier } from './evening-career-reflect.applier';

describe('EveningCareerReflectApplier', () => {
  const makePreview = (payload: unknown): PreviewAction =>
    ({
      id: 'test-id',
      slackUserId: 'U1',
      kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
      payload,
      status: 'PENDING',
      previewText: '경력 반영',
      responseUrl: null,
      expiresAt: new Date(),
      createdAt: new Date(),
      appliedAt: null,
      cancelledAt: null,
    }) as PreviewAction;

  it('(a) 정상 — reflectPr.execute 에 slackUserId 와 prRefs.join(줄바꿈) 을 위임하고 ApplyResult.message 를 반환한다', async () => {
    const reflectPr = {
      execute: jest.fn().mockResolvedValue({
        result: { portfolioUrl: 'https://notion.so/portfolio' },
      }),
    } as any;

    const applier = new EveningCareerReflectApplier(reflectPr);
    const prRefs = ['owner/repo#1', 'owner/repo#2'];
    const result = await applier.apply(
      makePreview({ prRefs, slackUserId: 'U1' }),
    );

    expect(reflectPr.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      prText: prRefs.join('\n'),
    });
    expect(result.message).toContain('2건');
    expect(result.message).toContain('https://notion.so/portfolio');
    expect(result.artifacts).toEqual([]);
  });

  it('(b) payload.prRefs 빈 배열 → throw', async () => {
    const reflectPr = { execute: jest.fn() } as any;
    const applier = new EveningCareerReflectApplier(reflectPr);

    await expect(
      applier.apply(makePreview({ prRefs: [], slackUserId: 'U1' })),
    ).rejects.toThrow('EVENING_CAREER_REFLECT: payload.prRefs 누락');

    expect(reflectPr.execute).not.toHaveBeenCalled();
  });

  it('(b-2) payload.prRefs 누락 → throw', async () => {
    const reflectPr = { execute: jest.fn() } as any;
    const applier = new EveningCareerReflectApplier(reflectPr);

    await expect(
      applier.apply(makePreview({ slackUserId: 'U1' })),
    ).rejects.toThrow('EVENING_CAREER_REFLECT: payload.prRefs 누락');

    expect(reflectPr.execute).not.toHaveBeenCalled();
  });
});
