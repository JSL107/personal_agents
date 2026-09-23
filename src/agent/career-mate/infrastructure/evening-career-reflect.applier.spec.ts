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
      expiresAt: new Date(),
      createdAt: new Date(),
      appliedAt: null,
      cancelledAt: null,
    }) as PreviewAction;

  // 묶음 회차는 portfolioSync: 'skip' 이라 결과에 portfolioUrl 이 없다 — 링크는 아래
  // renderPortfolio 가 루프 뒤에 한 번 호출돼 돌려준다.
  const okReflectPr = (): { execute: jest.Mock } => ({
    execute: jest.fn().mockResolvedValue({ result: {} }),
  });

  const renderPortfolio = (): { execute: jest.Mock } => ({
    execute: jest
      .fn()
      .mockResolvedValue({ url: 'https://notion.so/portfolio', pageId: 'p1' }),
  });

  it('(a) 묶음마다 reflectPr.execute 를 따로 호출한다 — 저장소가 섞인 성과를 만들지 않는다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

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
      portfolioSync: 'skip',
    });
    expect(reflectPr.execute).toHaveBeenNthCalledWith(2, {
      slackUserId: 'U1',
      prText: 'JSL107/personal_agents#400',
      portfolioSync: 'skip',
    });
    // 묶음 회차는 포트폴리오를 건드리지 않는다('skip'). 페이지를 통째로 다시 쓰는 작업이라
    // 묶음마다 하면 앞 회차분이 뒤 회차에 덮여 사라진다 — 그 반복이 이 경로의 실제 비용이다.
    for (const call of reflectPr.execute.mock.calls) {
      expect(call[0].portfolioSync).toBe('skip');
    }
    // 'defer' 는 이 경로에서 절대 쓰지 않는다. 아래 문구가 "반영했습니다" 로 단정하고 승인
    // 카드가 일회성이라, 미루면 아직 끝나지 않은 상태로 그 문구가 나가고 실패도 삼켜진다.
    for (const call of reflectPr.execute.mock.calls) {
      expect(call[0].portfolioSync).not.toBe('defer');
    }
  });

  it('(a-2) 묶음이 몇 개든 포트폴리오 반영은 딱 한 번이다 — 중복 재작성이 이 경로의 비용이었다', async () => {
    const reflectPr = okReflectPr();
    const portfolio = renderPortfolio();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      portfolio as never,
    );

    const result = await applier.apply(
      makePreview({
        prGroups: [['a/b#1'], ['c/d#2'], ['e/f#3'], ['g/h#4']],
        slackUserId: 'U1',
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(4);
    // 묶음 4건인데 포트폴리오 전체 재작성은 1회. 회차마다 하면 3회분이 뒤 회차에 덮여
    // 사라지는데, 한 번이 수백 초짜리라 그대로 대기 시간이 된다.
    expect(portfolio.execute).toHaveBeenCalledTimes(1);
    expect(portfolio.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    // 미루지 않는다 — 아래 문구가 "반영했습니다" 로 단정하고 카드는 재사용이 안 된다.
    expect(portfolio.execute.mock.calls[0][0].deferBlockSync).toBeUndefined();
    expect(result.message).toContain('https://notion.so/portfolio');
  });

  it('(a-3) 포트폴리오 반영이 실패해도 성공한 회고는 그대로 보고한다', async () => {
    const reflectPr = okReflectPr();
    const portfolio = {
      execute: jest.fn().mockRejectedValue(new Error('notion 500')),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      portfolio as never,
    );

    const result = await applier.apply(
      makePreview({ prGroups: [['a/b#1']], slackUserId: 'U1' }),
    );

    // 성과는 이미 career_profile 에 저장됐다. 여기서 던지면 성공한 회고까지 실패로 보고돼
    // 카드가 소비된 채 사라진다 — 나머지는 그대로 내되 포트폴리오만 사실대로 적는다.
    expect(result.message).toContain('a/b 1건');
    expect(result.message).not.toContain('undefined');
    // 안 된 것을 됐다고 하지 않는다. 카드는 이미 소비돼 다시 누를 수 없으므로, 여기서
    // 거짓을 말하면 사용자가 확인할 방법이 없다.
    expect(result.message).not.toContain('포트폴리오에 반영했습니다');
    expect(result.message).toContain('포트폴리오 페이지 갱신은 실패');
  });

  it('(a-4) 모든 묶음이 실패하면 포트폴리오를 건드리지 않는다', async () => {
    const reflectPr = {
      execute: jest.fn().mockRejectedValue(new Error('PR 접근 불가')),
    };
    const portfolio = renderPortfolio();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      portfolio as never,
    );

    await expect(
      applier.apply(makePreview({ prGroups: [['a/b#1']], slackUserId: 'U1' })),
    ).rejects.toThrow('모두 실패했습니다');
    // 반영할 새 성과가 없는데 페이지를 다시 쓸 이유가 없다.
    expect(portfolio.execute).not.toHaveBeenCalled();
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
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

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
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    const result = await applier.apply(
      makePreview({
        prGroups: [['a/b#1'], ['c/d#2']],
        slackUserId: 'U1',
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(2);
    expect(result.message).toContain('c/d 1건');
    // 카드는 재사용 불가 — 실패한 묶음을 손으로 다시 돌리려면 PR 참조가 있어야 한다.
    expect(result.message).toContain('반영 실패 1묶음');
    expect(result.message).toContain('a/b#1');
  });

  it('(d) 모든 묶음이 실패하면 throw 한다 — 성공으로 보고하지 않는다', async () => {
    const reflectPr = {
      execute: jest.fn().mockRejectedValue(new Error('PR 접근 불가')),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    await expect(
      applier.apply(
        makePreview({ prGroups: [['a/b#1'], ['c/d#2']], slackUserId: 'U1' }),
      ),
    ).rejects.toThrow('2개 묶음이 모두 실패했습니다');
  });

  it('(e) 그룹 도입 이전 카드(prRefs) 는 1개 묶음으로 받아준다 (하위호환)', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );
    const prRefs = ['owner/repo#1', 'owner/repo#2'];

    const result = await applier.apply(
      makePreview({ prRefs, slackUserId: 'U1' }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(1);
    expect(reflectPr.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      prText: prRefs.join('\n'),
      portfolioSync: 'skip',
    });
    expect(result.message).toContain('https://notion.so/portfolio');
    expect(result.artifacts).toEqual([]);
  });

  it('(f) prGroups·prRefs 둘 다 비면 throw', async () => {
    const reflectPr = { execute: jest.fn() };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

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

  it('(f) 맥락은 적어 넣은 묶음에만 실린다 — 회사 수치가 개인 성과로 새지 않는다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    const result = await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
        impactContexts: ['  결제 실패율 3%→0.5%  ', null],
      }),
    );

    expect(reflectPr.execute).toHaveBeenNthCalledWith(1, {
      slackUserId: 'U1',
      prText: 'o/company#1',
      impactContext: '결제 실패율 3%→0.5%',
      portfolioSync: 'skip',
    });
    // 두 번째 묶음은 도입 전과 완전히 같은 호출 형태여야 한다.
    expect(reflectPr.execute).toHaveBeenNthCalledWith(2, {
      slackUserId: 'U1',
      prText: 'o/personal#9',
      portfolioSync: 'skip',
    });
    expect(result.message).toContain('o/company 1건(맥락 반영)');
    expect(result.message).toContain('o/personal 1건');
    expect(result.message).not.toContain('o/personal 1건(맥락 반영)');
  });

  it('(g) impactContexts 가 없으면 도입 전과 같은 호출만 남는다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    const result = await applier.apply(
      makePreview({ prGroups: [['o/company#1']], slackUserId: 'U1' }),
    );

    expect(reflectPr.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      prText: 'o/company#1',
      portfolioSync: 'skip',
    });
    expect(result.message).not.toContain('맥락 반영');
  });

  it('(h) 공백만 적힌 맥락은 없는 것과 같게 다룬다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    await applier.apply(
      makePreview({
        prGroups: [['o/company#1']],
        slackUserId: 'U1',
        impactContexts: ['   '],
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      prText: 'o/company#1',
      portfolioSync: 'skip',
    });
  });

  it('(i) 묶음이 실패하면 적어둔 맥락도 함께 돌려준다 — 카드는 다시 못 누른다', async () => {
    const reflectPr = {
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('PR 접근 불가'))
        .mockResolvedValueOnce({
          result: { portfolioUrl: 'https://notion.so/portfolio' },
        }),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    const result = await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
        impactContexts: ['결제 실패율 3%→0.5%', null],
      }),
    );

    expect(result.message).toContain('반영 실패 1묶음');
    expect(result.message).toContain('• o/company#1');
    // 이 줄이 없으면 사용자가 손으로 적은 문장이 어디에도 남지 않는다.
    expect(result.message).toContain('적어두신 맥락: 결제 실패율 3%→0.5%');
  });

  it('(j) 맥락 없이 실패한 묶음은 PR 참조만 (군더더기 줄 없음)', async () => {
    const reflectPr = {
      execute: jest.fn().mockRejectedValueOnce(new Error('PR 접근 불가')),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    await expect(
      applier.apply(
        makePreview({ prGroups: [['o/company#1']], slackUserId: 'U1' }),
      ),
    ).rejects.toThrow('1개 묶음이 모두 실패했습니다');
  });

  it('(k) 실패 안내는 진짜 줄바꿈을 쓴다 — 백슬래시 n 이 글자로 찍히면 한 줄로 뭉개진다', async () => {
    const reflectPr = {
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('PR 접근 불가'))
        .mockResolvedValueOnce({
          result: { portfolioUrl: 'https://notion.so/portfolio' },
        }),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    const result = await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
      }),
    );

    expect(result.message).not.toContain('\\n');
    expect(result.message.split('\n').length).toBeGreaterThan(1);
  });

  it('(l) 이미 반영된 묶음은 건너뛴다 — 재개가 중복 반영이 되면 막으려던 사고를 그대로 다시 낸다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    const result = await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
      }),
      { done: ['0:o/company#1'], record: jest.fn() },
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(1);
    expect(reflectPr.execute).toHaveBeenCalledWith(
      expect.objectContaining({ prText: 'o/personal#9' }),
    );
    // 건너뛴 묶음도 결과에 남겨야 한다 — 빠지면 사용자는 그 성과가 유실된 줄 안다.
    expect(result.message).toContain('이미 반영됨');
  });

  it('(m) 묶음이 끝날 때마다, 다음 묶음을 시작하기 전에 기록한다 — 기록이 밀리면 그 사이 중단에 유실된다', async () => {
    const order: string[] = [];
    const reflectPr = {
      execute: jest
        .fn()
        .mockImplementation(async ({ prText }: { prText: string }) => {
          order.push(`실행:${prText}`);
          return { result: { portfolioUrl: 'https://notion.so/p' } };
        }),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );
    const record = jest.fn().mockImplementation(async (step: string) => {
      order.push(`기록:${step}`);
    });

    await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
      }),
      { done: [], record },
    );

    expect(order).toEqual([
      '실행:o/company#1',
      '기록:0:o/company#1',
      '실행:o/personal#9',
      '기록:1:o/personal#9',
    ]);
  });

  it('(n) 실패한 묶음은 기록하지 않는다 — 기록하면 재개가 그 묶음을 끝난 것으로 보고 건너뛴다', async () => {
    const reflectPr = {
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('PR 접근 불가'))
        .mockResolvedValueOnce({
          result: { portfolioUrl: 'https://notion.so/portfolio' },
        }),
    };
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );
    const record = jest.fn().mockResolvedValue(undefined);

    await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
      }),
      { done: [], record },
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('1:o/personal#9');
  });

  it('(o) progress 가 없어도 종전처럼 전부 실행한다 — 옛 호출부와 단위 테스트가 그대로 돈다', async () => {
    const reflectPr = okReflectPr();
    const applier = new EveningCareerReflectApplier(
      reflectPr as never,
      renderPortfolio() as never,
    );

    await applier.apply(
      makePreview({
        prGroups: [['o/company#1'], ['o/personal#9']],
        slackUserId: 'U1',
      }),
    );

    expect(reflectPr.execute).toHaveBeenCalledTimes(2);
  });
});
