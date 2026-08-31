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

  const okReflectPr = (): { execute: jest.Mock } => ({
    execute: jest.fn().mockResolvedValue({
      result: { portfolioUrl: 'https://notion.so/portfolio' },
    }),
  });

  it('(a) 묶음마다 reflectPr.execute 를 따로 호출한다 — 저장소가 섞인 성과를 만들지 않는다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(reflectPr as never);

    await applier.apply(
      makePreview({
        prGroups: [
          ['schoolbell-e/sbe-api-v5#10', 'schoolbell-e/sbe-api-v5#11'],
          ['JSL107/personal_agents#400'],
        ],
        slackUserId: 'U1',
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(2);
    expect(reflectPr.execute).toHaveBeenNthCalledWith(1, {
      slackUserId: 'U1',
      prText: 'schoolbell-e/sbe-api-v5#10\nschoolbell-e/sbe-api-v5#11',
    });
    expect(reflectPr.execute).toHaveBeenNthCalledWith(2, {
      slackUserId: 'U1',
      prText: 'JSL107/personal_agents#400',
    });
  });

  it('(b) 묶음을 순차로 실행한다 — 병렬이면 뒤 저장이 앞 성과를 덮어쓴다(lost update)', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const reflectPr = {
      execute: jest.fn().mockImplementation(async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { result: { portfolioUrl: 'https://notion.so/p' } };
      }),
    };
    const applier = new EveningCareerReflectApplier(reflectPr as never);

    await applier.apply(
      makePreview({
        prGroups: [['a/b#1'], ['c/d#2'], ['e/f#3']],
        slackUserId: 'U1',
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBe(1);
  });

  it('(c) 한 묶음이 실패해도 나머지는 반영한다 — 카드는 한 번 쓰면 다시 못 누른다', async () => {
    const reflectPr = {
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('PR 접근 불가'))
        .mockResolvedValueOnce({
          result: { portfolioUrl: 'https://notion.so/portfolio' },
        }),
    };
    const applier = new EveningCareerReflectApplier(reflectPr as never);

    const result = await applier.apply(
      makePreview({
        prGroups: [['a/b#1'], ['c/d#2']],
        slackUserId: 'U1',
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(2);
    expect(result.message).toContain('c/d 1건');
    expect(result.message).toContain('실패: a/b');
  });

  it('(d) 모든 묶음이 실패하면 throw 한다 — 성공으로 보고하지 않는다', async () => {
    const reflectPr = {
      execute: jest.fn().mockRejectedValue(new Error('PR 접근 불가')),
    };
    const applier = new EveningCareerReflectApplier(reflectPr as never);

    await expect(
      applier.apply(
        makePreview({ prGroups: [['a/b#1'], ['c/d#2']], slackUserId: 'U1' }),
      ),
    ).rejects.toThrow('2개 묶음이 모두 실패했습니다');
  });

  it('(e) 그룹 도입 이전 카드(prRefs) 는 1개 묶음으로 받아준다 (하위호환)', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(reflectPr as never);
    const prRefs = ['owner/repo#1', 'owner/repo#2'];

    const result = await applier.apply(
      makePreview({ prRefs, slackUserId: 'U1' }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(1);
    expect(reflectPr.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      prText: prRefs.join('\n'),
    });
    expect(result.message).toContain('https://notion.so/portfolio');
    expect(result.artifacts).toEqual([]);
  });

  it('(f) prGroups·prRefs 둘 다 비면 throw', async () => {
    const reflectPr = { execute: jest.fn() };
    const applier = new EveningCareerReflectApplier(reflectPr as never);

    await expect(
      applier.apply(
        makePreview({ prGroups: [], prRefs: [], slackUserId: 'U1' }),
      ),
    ).rejects.toThrow('EVENING_CAREER_REFLECT: payload.prGroups/prRefs 누락');

    await expect(
      applier.apply(makePreview({ slackUserId: 'U1' })),
    ).rejects.toThrow('EVENING_CAREER_REFLECT: payload.prGroups/prRefs 누락');

    expect(reflectPr.execute).not.toHaveBeenCalled();
  });
});
