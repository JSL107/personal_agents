import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { EveningRetroPublishTask } from './evening-retro-publish.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-03' };

const RETRO_RESPONSE = {
  text: JSON.stringify({
    retrospective: 'r',
    candidates: [
      {
        title: 'T',
        keywords: ['k'],
        blogValueScore: 70,
        reason: '실제 PR 근거가 충분하다.',
        sourceRefs: ['schoolbell-e/sbe-api-v5#864'],
        outline: [
          '문제: PR 승인 전에는 정합성 문제가 드러나지 않았다.',
          '접근: user_to_group 동기화 경계를 보강했다.',
          '결과: 유령 학급 재발 가능성을 낮췄다.',
        ],
      },
    ],
    prNotes: [
      {
        ref: 'schoolbell-e/sbe-api-v5#864',
        note: 'user_to_group 정합성 문제를 트랜잭션 경계로 보강',
      },
    ],
  }),
  modelUsed: 'gpt',
  provider: 'CHATGPT',
};

const PR_ITEM = {
  repo: 'schoolbell-e/sbe-api-v5',
  number: 864,
  url: 'https://x',
  title: 't',
  body: 'b',
  mergedAt: '2026-07-03',
  additions: 0,
  deletions: 0,
  changedFilesCount: 0,
};

const makeTask = (opts: {
  enabledVal?: string;
  authorVal?: string;
  personalRepositoriesVal?: string;
  prs?: (typeof PR_ITEM)[];
  worklogRuns?: { id: number; output: unknown; endedAt: Date }[];
  dailyEvalRuns?: { id: number; output: unknown; endedAt: Date }[];
  routeResult?: { text: string; modelUsed: string; provider: string };
  humanized?: Record<string, string>;
}) => {
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'EVENING_RETRO_PUBLISH_ENABLED') {
        return opts.enabledVal;
      }
      if (key === 'IMPACT_REPORT_GITHUB_AUTHOR') {
        return opts.authorVal ?? 'me';
      }
      if (key === 'PERSONAL_REPOS') {
        return opts.personalRepositoriesVal;
      }
      return undefined;
    }),
  };

  const githubClient = {
    listAuthorMergedPullRequestsSince: jest
      .fn()
      .mockResolvedValue(opts.prs ?? []),
  };

  const agentRunService = {
    findRecentSucceededRuns: jest
      .fn()
      .mockImplementation((args: { agentType: AgentType }) => {
        if (args.agentType === AgentType.WORK_REVIEWER) {
          return Promise.resolve(opts.worklogRuns ?? []);
        }
        if (args.agentType === AgentType.PO_EVAL) {
          return Promise.resolve(opts.dailyEvalRuns ?? []);
        }
        return Promise.resolve([]);
      }),
    // 실제 execute 와 같은 계약으로 흉내낸다 — run 을 실행하고 결과를 outcome 으로 감싼다.
    // 그냥 값을 돌려주면 회고 생성이 실제로 호출되는지가 테스트에서 사라진다.
    execute: jest
      .fn()
      .mockImplementation(
        async ({
          run,
        }: {
          run: (context: {
            agentRunId: number;
          }) => Promise<{ result: unknown; modelUsed: string }>;
        }) => {
          const execution = await run({ agentRunId: 1 });
          return {
            result: execution.result,
            modelUsed: execution.modelUsed,
            agentRunId: 1,
          };
        },
      ),
  };

  const modelRouter = {
    route: jest.fn().mockResolvedValue(opts.routeResult ?? RETRO_RESPONSE),
  };

  // 기본은 통과(입력 그대로 반환) — 실패해도 원본을 돌려주는 실제 best-effort 계약과 같다.
  const humanizeService = {
    humanize: jest
      .fn()
      .mockImplementation((fields: Record<string, string>) =>
        Promise.resolve(opts.humanized ?? fields),
      ),
  };

  const task = new EveningRetroPublishTask(
    agentRunService as never,
    githubClient as never,
    modelRouter as never,
    humanizeService as never,
    config as never,
  );

  return {
    task,
    config,
    githubClient,
    agentRunService,
    modelRouter,
    humanizeService,
  };
};

describe('EveningRetroPublishTask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(a) EVENING_RETRO_PUBLISH_ENABLED=false 이면 skip=true, route 미호출', async () => {
    const { task, modelRouter } = makeTask({ enabledVal: 'false' });

    const result = await task.run(CTX);

    expect(result.skip).toBe(true);
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('(b) 소스 전무(PR 0건, worklog null, dailyEval null) → skip=true, route 미호출', async () => {
    const { task, modelRouter } = makeTask({
      prs: [],
      worklogRuns: [],
      dailyEvalRuns: [],
    });

    const result = await task.run(CTX);

    expect(result.skip).toBe(true);
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('(c) PR 1건 있음 → previews.length === 2, 경력 payload.prRefs에 schoolbell-e/sbe-api-v5#864 포함', async () => {
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.previews).toHaveLength(2);

    const careerPreview = result.previews?.find(
      (p) => p.kind === PREVIEW_KIND.EVENING_CAREER_REFLECT,
    );
    expect(careerPreview).toBeDefined();
    expect((careerPreview?.payload as { prRefs: string[] }).prRefs).toContain(
      'schoolbell-e/sbe-api-v5#864',
    );
  });

  it('(c-2) 회고 생성을 EVENING_RETRO 실행 원장으로 감싼다', async () => {
    const { task, agentRunService } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    // 원장을 거치지 않으면 카드가 안 온 날 실패인지 후보 0건인지 구분할 근거가 없다.
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.EVENING_RETRO,
        triggerType: TriggerType.AUTOPILOT_EVENING_RETRO_CRON,
      }),
    );
  });

  it('(c-3) 회고 생성이 실패하면 원장에 남기고 카드 없이 fallback 한다', async () => {
    const { task, agentRunService } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
    });
    agentRunService.execute.mockRejectedValue(new Error('codex down'));

    const result = await task.run(CTX);

    expect(agentRunService.execute).toHaveBeenCalledTimes(1);
    expect(result.skip).toBe(false);
    expect(result.previews).toBeUndefined();
    expect(result.summaryText).toContain('codex down');
  });

  it('(d) PR 없음 + worklog run 1건 있음 → previews.length === 1 (블로그만)', async () => {
    const { task } = makeTask({
      prs: [],
      worklogRuns: [{ id: 1, output: 'worklog text', endedAt: new Date() }],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.previews).toHaveLength(1);
    expect(result.previews?.[0].kind).toBe(PREVIEW_KIND.EVENING_BLOG_PUBLISH);
  });

  it('(e) GitHub merged 조회는 오늘 KST 00:00 을 UTC(Z) 표기로 sinceIsoDate 에 넘긴다', async () => {
    const { task, githubClient } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    // KST 2026-07-08 00:00 == UTC 2026-07-07 15:00. 가리키는 순간은 같지만 표기가 다르다.
    expect(githubClient.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      expect.objectContaining({
        sinceIsoDate: '2026-07-07T15:00:00.000Z',
      }),
    );
  });

  // 회귀 방지 — 이전엔 `2026-07-08T00:00:00+09:00` 을 넘겼고, 이 값이 GitHub search 쿼리에
  // 들어가면 octokit 이 `+` 를 escape 하지 않아 GitHub 이 날짜를 못 읽고 조용히 0건을 반환했다.
  // 에러가 아니라 "머지된 PR 없음" 으로 위장돼 두 주 가까이 발행 후보가 사라졌다.
  it('(e-2) sinceIsoDate 에 URL 인코딩을 깨뜨리는 `+` offset 을 넣지 않는다', async () => {
    const { task, githubClient } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    const [call] = (githubClient.listAuthorMergedPullRequestsSince as jest.Mock)
      .mock.calls;
    expect(call[0].sinceIsoDate).not.toContain('+');
  });

  it('(f) 회고 prompt 에 회사/개인 소스 라벨을 포함한다', async () => {
    const personalPr = {
      ...PR_ITEM,
      repo: 'JSL107/personal_agents',
      number: 142,
      title: '개인 PR',
    };
    const { task, modelRouter } = makeTask({
      authorVal: 'JSL107',
      prs: [PR_ITEM, personalPr],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    const routeInput = modelRouter.route.mock.calls[0][0];
    expect(routeInput.request.prompt).toContain(
      '[회사 실무][schoolbell-e/sbe-api-v5#864]',
    );
    expect(routeInput.request.prompt).toContain(
      '[개인 프로젝트][JSL107/personal_agents#142]',
    );
  });

  it('(g) summary 와 블로그 preview 에 reason/sourceRefs/sourcePrs 를 반영한다', async () => {
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);
    const blogPreview = result.previews?.find(
      (preview) => preview.kind === PREVIEW_KIND.EVENING_BLOG_PUBLISH,
    );
    const payload = blogPreview?.payload as {
      topPick: {
        title: string;
        keywords: string[];
        reason: string;
        sourceRefs: string[];
        outline: string[];
      };
      sourcePrs: Array<{
        repo: string;
        number: number;
        url: string;
        title: string;
        body: string;
      }>;
    };

    expect(result.summaryText).toContain('회사 실무');
    expect(result.summaryText).toContain('실제 PR 근거가 충분하다.');
    expect(blogPreview?.previewText).toContain('근거 PR: sbe-api-v5#864');
    expect(blogPreview?.previewText).toContain(
      '왜 쓸 가치: 실제 PR 근거가 충분하다.',
    );
    expect(blogPreview?.previewText).toContain('*초안 개요*');
    expect(blogPreview?.previewText).toContain(
      '• 문제: PR 승인 전에는 정합성 문제가 드러나지 않았다.',
    );
    expect(payload.topPick.reason).toBe('실제 PR 근거가 충분하다.');
    expect(payload.topPick.sourceRefs).toEqual(['schoolbell-e/sbe-api-v5#864']);
    expect(payload.topPick.outline).toEqual([
      '문제: PR 승인 전에는 정합성 문제가 드러나지 않았다.',
      '접근: user_to_group 동기화 경계를 보강했다.',
      '결과: 유령 학급 재발 가능성을 낮췄다.',
    ]);
    expect(payload.sourcePrs).toEqual([
      {
        repo: 'schoolbell-e/sbe-api-v5',
        number: 864,
        url: 'https://x',
        title: 't',
        body: 'b',
      },
    ]);
  });

  it('(g-2) outline 이 비어 있으면 블로그 preview 의 초안 개요 블록을 생략한다', async () => {
    const routeResult = {
      ...RETRO_RESPONSE,
      text: JSON.stringify({
        retrospective: 'r',
        candidates: [
          {
            title: 'T',
            keywords: ['k'],
            blogValueScore: 70,
            reason: '실제 PR 근거가 충분하다.',
            sourceRefs: ['schoolbell-e/sbe-api-v5#864'],
            outline: [],
          },
        ],
        prNotes: [],
      }),
    };
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult,
    });

    const result = await task.run(CTX);
    const blogPreview = result.previews?.find(
      (preview) => preview.kind === PREVIEW_KIND.EVENING_BLOG_PUBLISH,
    );

    expect(blogPreview?.previewText).not.toContain('*초안 개요*');
    expect(blogPreview?.previewText).not.toContain('초안 개요를 근거로');
    expect(blogPreview?.previewText).toContain('위 PR 내용을 근거로');
  });

  it('(h) 경력 preview 는 회사/개인 repository 를 그룹화해서 표시한다', async () => {
    const personalPr = {
      ...PR_ITEM,
      repo: 'JSL107/personal_agents',
      number: 142,
      title: '개인 프로젝트 저녁 회고 개선',
    };
    const { task } = makeTask({
      authorVal: 'JSL107',
      prs: [PR_ITEM, personalPr],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);
    const careerPreview = result.previews?.find(
      (preview) => preview.kind === PREVIEW_KIND.EVENING_CAREER_REFLECT,
    );

    expect(careerPreview?.previewText).toContain('• 회사 실무:');
    expect(careerPreview?.previewText).toContain(
      '• schoolbell-e/sbe-api-v5#864 — user_to_group 정합성 문제를 트랜잭션 경계로 보강',
    );
    expect(careerPreview?.previewText).toContain('• 개인 프로젝트(이대리):');
    expect(careerPreview?.previewText).toContain(
      '• JSL107/personal_agents#142 — 개인 프로젝트 저녁 회고 개선',
    );
  });

  it('(i) 저녁 회고 LLM 호출은 기존 1회만 수행한다', async () => {
    const { task, modelRouter } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    expect(modelRouter.route).toHaveBeenCalledTimes(1);
  });

  it('(j) PERSONAL_REPOS 미설정이어도 author owner repository 를 개인 프로젝트로 표시한다', async () => {
    const personalPr = {
      ...PR_ITEM,
      repo: 'me/personal_agents',
      number: 142,
    };
    const { task } = makeTask({
      authorVal: 'me',
      personalRepositoriesVal: undefined,
      prs: [PR_ITEM, personalPr],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: {
        ...RETRO_RESPONSE,
        text: JSON.stringify({
          retrospective: 'r',
          candidates: [
            {
              title: 'T',
              keywords: ['k'],
              blogValueScore: 70,
              reason: '개인 repo owner 기준으로 분류한다.',
              sourceRefs: ['me/personal_agents#142'],
            },
          ],
        }),
      },
    });

    const result = await task.run(CTX);
    const careerPreview = result.previews?.find(
      (preview) => preview.kind === PREVIEW_KIND.EVENING_CAREER_REFLECT,
    );

    expect(result.summaryText).toContain('개인 프로젝트(이대리)');
    expect(careerPreview?.previewText).toContain('• 회사 실무:');
    expect(careerPreview?.previewText).toContain('schoolbell-e/sbe-api-v5#864');
    expect(careerPreview?.previewText).toContain('• 개인 프로젝트(이대리):');
    expect(careerPreview?.previewText).toContain('me/personal_agents#142');
  });

  it('(k) 근거 PR 0건이면 요약에 그 사실을 남긴다 (조용한 0건 방지)', async () => {
    const { task } = makeTask({
      prs: [],
      worklogRuns: [{ id: 1, output: 'worklog text', endedAt: new Date() }],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.summaryText).toContain('0건으로 조회됐습니다');
  });

  it('(l) author env 미설정이면 조회를 건너뛴 사실을 요약에 남긴다', async () => {
    const { task, githubClient } = makeTask({
      authorVal: '',
      prs: [],
      worklogRuns: [{ id: 1, output: 'worklog text', endedAt: new Date() }],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(
      githubClient.listAuthorMergedPullRequestsSince,
    ).not.toHaveBeenCalled();
    expect(result.summaryText).toContain('IMPACT_REPORT_GITHUB_AUTHOR');
  });

  it('(m) 근거 PR 이 있으면 경고를 붙이지 않는다', async () => {
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.summaryText).not.toContain('⚠️');
  });

  it('(n) 회고 문단·후보 이유를 윤문한 결과로 요약을 만든다 (모델 원문 그대로 내보내지 않는다)', async () => {
    const { task, humanizeService } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
      humanized: {
        retrospective: '윤문된 회고',
        'candidates.title.0': '윤문된 제목',
        'candidates.reason.0': '윤문된 이유',
        'prNotes.note.0': '윤문된 PR 노트',
      },
    });

    const result = await task.run(CTX);

    // 윤문에 넘긴 필드 — sourceRefs 가 섞이면 PR 매칭이 조용히 깨지므로 키 집합까지 확인한다.
    expect(
      Object.keys(humanizeService.humanize.mock.calls[0][0]).sort(),
    ).toEqual([
      'candidates.reason.0',
      'candidates.title.0',
      'prNotes.note.0',
      'retrospective',
    ]);
    expect(result.summaryText).toContain('윤문된 회고');
    expect(result.summaryText).toContain('윤문된 제목');
    expect(result.summaryText).toContain('윤문된 이유');
    expect(result.summaryText).not.toContain('실제 PR 근거가 충분하다.');
  });

  it('(o) 후보가 상위 정원을 넘으면 요약엔 3건만 세우고 전체는 스레드로 내린다', async () => {
    const manyCandidates = {
      text: JSON.stringify({
        retrospective: 'r',
        candidates: [95, 90, 85, 80].map((score) => ({
          title: `제목${score}`,
          keywords: ['k'],
          blogValueScore: score,
          reason: '이유',
          sourceRefs: ['schoolbell-e/sbe-api-v5#864'],
          outline: [],
        })),
        prNotes: [],
      }),
      modelUsed: 'gpt',
      provider: 'CHATGPT',
    };
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: manyCandidates,
    });

    const result = await task.run(CTX);

    expect(result.summaryText).toContain('제목95');
    expect(result.summaryText).not.toContain('제목80');
    expect(result.summaryText).toContain('4건 중 상위 3건');
    expect(result.detailText).toContain('제목80');
    expect(result.detailText).toContain('발행 후보 전체 — 4건');
  });

  it('(o-2) 긴 이유는 문장 한복판이 아니라 문장 경계에서 끊는다', async () => {
    const longReason = {
      text: JSON.stringify({
        retrospective: 'r',
        candidates: [
          {
            title: '제목',
            keywords: [],
            blogValueScore: 90,
            // 첫 문장 25자 + 뒤 세 문장 → 합계가 80자 상한을 넘겨 자르기가 걸린다.
            reason:
              '계획서를 실적으로 재서술하던 문제를 바로잡았다. 계획과 실적도 분리했다. 성과 평가의 신뢰성과 증거 설계를 함께 다뤄 블로그 가치가 높다. 자동화된 평가의 근거 설계를 설명할 수 있다.',
            sourceRefs: ['schoolbell-e/sbe-api-v5#864'],
            outline: [],
          },
        ],
        prNotes: [],
      }),
      modelUsed: 'gpt',
      provider: 'CHATGPT',
    };
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: longReason,
    });

    const result = await task.run(CTX);

    expect(result.summaryText).toContain(
      '계획서를 실적으로 재서술하던 문제를 바로잡았다. …',
    );
    // 문장 중간에서 잘려 뜻이 끊기면 안 된다 — 뒷 문장은 통째로 스레드에만 있다.
    expect(result.summaryText).not.toContain('블로그 가치가 높다');
    expect(result.detailText).toContain(
      '자동화된 평가의 근거 설계를 설명할 수 있다.',
    );
  });

  it('(p) 후보가 정원 이내이고 잘린 이유도 없으면 스레드를 만들지 않는다 (본문 반복 방지)', async () => {
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.detailText).toBeUndefined();
  });
});
