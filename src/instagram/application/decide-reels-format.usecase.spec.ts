import {
  ReelFormatDecisionMode,
  ReelFormatVerdict,
} from '../domain/format-decision.policy';
import { assignArm, FormatPolicy } from '../domain/format-policy';
import {
  EMPTY_INSIGHT_METRICS,
  InsightSnapshot,
  SnapshotWindow,
} from '../domain/instagram-insight.type';
import {
  InstagramPost,
  InstagramPostStatus,
} from '../domain/instagram-post.type';
import { FormatPolicyStorePort } from '../domain/port/format-policy-store.port';
import { InstagramInsightSnapshotRepositoryPort } from '../domain/port/instagram-insight-snapshot.repository.port';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';
import {
  ReelFormatDecision,
  ReelFormatDecisionRepositoryPort,
} from '../domain/port/reel-format-decision.repository.port';
import { ReelFormatPlannerPort } from '../domain/port/reel-format-planner.port';
import { DecideReelsFormatUsecase } from './decide-reels-format.usecase';

const policy: FormatPolicy = {
  version: 1,
  frozen: false,
  champion: { early_card: false },
  experiment: {
    id: 'early_card-2026-10-01',
    knob: 'early_card',
    challenger: true,
    start: '2026-10-01',
  },
};

const decisionRow = (
  overrides: Partial<ReelFormatDecision> = {},
): ReelFormatDecision => ({
  id: 'row-1',
  experimentId: policy.experiment!.id,
  knob: 'early_card',
  championValue: false,
  challengerValue: true,
  nChampion: 0,
  nChallenger: 0,
  excluded: 0,
  statsJson: {},
  verdict: ReelFormatVerdict.ABORT,
  mode: ReelFormatDecisionMode.PROPOSAL,
  reverseChallenge: false,
  reason: 'timeout',
  policyVersionBefore: 1,
  policyVersionAfter: 2,
  policyAfter: { ...policy, version: 2, experiment: null },
  aiProposal: { error: 'timeout' },
  decidedAt: new Date('2026-11-08T00:00:00Z'),
  reportedAt: null,
  createdAt: new Date('2026-11-08T00:00:00Z'),
  ...overrides,
});

const setup = () => {
  const store = {
    read: jest.fn().mockResolvedValue({ kind: 'ok', policy }),
    write: jest.fn().mockResolvedValue(undefined),
  };
  const decisions = {
    listAll: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockResolvedValue(true),
    markReported: jest.fn().mockResolvedValue(undefined),
  };
  const posts = { listPublishedSince: jest.fn().mockResolvedValue([]) };
  const snapshots = { listByPostIds: jest.fn().mockResolvedValue([]) };
  const planner = {
    propose: jest.fn().mockResolvedValue({
      hypothesis: '확인한다',
      interpretation: '표본을 더 모은다.',
      raw: '{}',
    }),
  };
  const usecase = new DecideReelsFormatUsecase(
    store as unknown as FormatPolicyStorePort,
    decisions as unknown as ReelFormatDecisionRepositoryPort,
    posts as unknown as InstagramPostRepositoryPort,
    snapshots as unknown as InstagramInsightSnapshotRepositoryPort,
    planner as unknown as ReelFormatPlannerPort,
  );
  usecase.now = () => new Date('2026-11-09T00:00:00Z');
  return { store, decisions, posts, snapshots, planner, usecase };
};

const scoredPosts = (): {
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
} => {
  const posts: InstagramPost[] = [];
  const snapshots: InsightSnapshot[] = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const day = new Date(
      Date.parse('2026-10-01T00:00:00Z') + offset * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const assignment = assignArm(policy, day);
    const postId = `post-${offset}`;
    posts.push({
      id: postId,
      reelKey: `${day}/daily`,
      status: InstagramPostStatus.PUBLISHED,
      publishedAt: new Date(`${day}T03:00:00Z`),
      features: {
        experiment: {
          policyVersion: 1,
          source: 'policy',
          experimentId: policy.experiment!.id,
          knob: 'early_card',
          arm: assignment.arm,
          values: assignment.values,
          realized: true,
          checks: {},
        },
      },
    } as unknown as InstagramPost);
    snapshots.push({
      id: `snapshot-${offset}`,
      postId,
      snapshotWindow: SnapshotWindow.AFTER_3_DAYS,
      capturedAt: new Date(`${day}T03:00:00Z`),
      ageMinutes: 4320,
      metrics: {
        ...EMPTY_INSIGHT_METRICS,
        views: 100,
        skipRate: assignment.arm === 'champion' ? 80 : 60,
        avgWatchMs: 2500,
      },
      followersCount: null,
      error: null,
      raw: null,
    });
  }
  return { posts, snapshots };
};

const worstGuardPosts = (): {
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
} => {
  const scored = scoredPosts();
  for (let index = 0; index < 4; index += 1) {
    const post = scored.posts[index];
    post.features!.experiment!.policyVersion = 2;
    post.features!.experiment!.values.early_card = true;
    scored.snapshots[index].metrics.skipRate = 72.01;
  }
  return {
    posts: scored.posts.slice(0, 4),
    snapshots: scored.snapshots.slice(0, 4),
  };
};

describe('DecideReelsFormatUsecase', () => {
  it('출력 폴더가 없으면 경고하고 파일을 쓰지 않는다', async () => {
    const { usecase, store } = setup();
    store.read.mockResolvedValue({ kind: 'no_directory' });
    expect((await usecase.execute())?.text).toContain('폴더');
    expect(store.write).not.toHaveBeenCalled();
  });

  it('깨진 정책이면 경고하고 원장도 파일도 쓰지 않는다', async () => {
    const { usecase, store, decisions } = setup();
    store.read.mockResolvedValue({ kind: 'broken', reason: 'version' });
    expect((await usecase.execute())?.text).toContain('version');
    expect(store.write).not.toHaveBeenCalled();
    expect(decisions.insert).not.toHaveBeenCalled();
  });

  it('정책을 못 읽는 동안에는 미보고 판정을 보고 완료로 넘기지 않는다', async () => {
    const { usecase, store, decisions } = setup();
    decisions.listAll.mockResolvedValue([decisionRow()]);
    store.read.mockResolvedValue({ kind: 'broken', reason: 'version' });
    const report = await usecase.execute();
    expect(report?.reportedIds).toEqual([]);
    expect(report?.text).not.toContain('릴스 형식 판정');
  });

  it('원장이 비고 파일이 없으면 초기 정책을 쓴다', async () => {
    const { usecase, store } = setup();
    store.read.mockResolvedValue({ kind: 'missing' });
    await usecase.execute();
    expect(store.write).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        experiment: expect.objectContaining({ start: '2026-11-10' }),
      }),
    );
  });

  it('파일이 없고 원장이 있으면 마지막 policyAfter를 그대로 복구한다', async () => {
    const { usecase, store, decisions } = setup();
    const row = decisionRow({
      policyAfter: { ...policy, version: 7, frozen: true },
    });
    decisions.listAll.mockResolvedValue([row]);
    store.read.mockResolvedValue({ kind: 'missing' });
    const report = await usecase.execute();
    expect(store.write).toHaveBeenCalledWith(row.policyAfter);
    expect(report?.text).toContain('v7으로 복구');
    expect(report?.reportedIds).toEqual(['row-1']);
  });

  it('최신 원장의 정책을 읽을 수 없고 파일이 이전 버전이면 판정과 보고를 중단한다', async () => {
    const { usecase, store, decisions, planner } = setup();
    decisions.listAll.mockResolvedValue([
      decisionRow({ policyAfter: null, policyVersionAfter: 2 }),
    ]);

    expect(await usecase.execute()).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
    expect(decisions.insert).not.toHaveBeenCalled();
    expect(planner.propose).not.toHaveBeenCalled();
  });

  it('파일이 최신 버전이어도 원장 정책을 읽을 수 없으면 판정과 보고를 중단한다', async () => {
    const { usecase, store, decisions } = setup();
    decisions.listAll.mockResolvedValue([
      decisionRow({ policyAfter: null, policyVersionAfter: 2 }),
    ]);
    store.read.mockResolvedValue({
      kind: 'ok',
      policy: { ...policy, version: 2, frozen: true },
    });

    expect(await usecase.execute()).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it.each([
    ['챔피언', { championValue: null }],
    ['도전자', { challengerValue: null }],
  ])(
    '원장의 %s 값이 잘못되면 보고와 새 판정을 모두 중단한다',
    async (_label, overrides) => {
      const { usecase, store, decisions, planner } = setup();
      decisions.listAll.mockResolvedValue([decisionRow(overrides)]);

      expect(await usecase.execute()).toBeNull();
      expect(store.write).not.toHaveBeenCalled();
      expect(decisions.insert).not.toHaveBeenCalled();
      expect(planner.propose).not.toHaveBeenCalled();
    },
  );

  it('동결 정책이고 미보고 행이 없으면 아무것도 보고하지 않는다', async () => {
    const { usecase, store } = setup();
    store.read.mockResolvedValue({
      kind: 'ok',
      policy: { ...policy, frozen: true },
    });
    expect(await usecase.execute()).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('미보고 판정은 발송 표시 전까지 같은 내용으로 재전송한다', async () => {
    const { usecase, store, decisions } = setup();
    const row = decisionRow({
      policyAfter: { ...policy, version: 2, frozen: true },
    });
    decisions.listAll.mockImplementation(async () => [row]);
    store.read.mockResolvedValue({
      kind: 'ok',
      policy: row.policyAfter,
    });
    const first = await usecase.execute();
    const second = await usecase.execute();
    expect(second).toEqual(first);
    expect(first?.reportedIds).toEqual(['row-1']);
    await usecase.markReported(first?.reportedIds ?? []);
    expect(decisions.markReported).toHaveBeenCalledWith(['row-1']);
    row.reportedAt = new Date();
    expect(await usecase.execute()).toBeNull();
  });

  it('표본이 아직 부족하고 30일 안이면 판정하지 않는다', async () => {
    const { usecase, store, decisions } = setup();
    store.read.mockResolvedValue({
      kind: 'ok',
      policy: {
        ...policy,
        experiment: { ...policy.experiment!, start: '2026-11-01' },
      },
    });
    expect(await usecase.execute()).toBeNull();
    expect(decisions.insert).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('기간 초과 판정의 원장 insert가 중복이면 정책을 쓰지 않는다', async () => {
    const { usecase, store, decisions } = setup();
    decisions.insert.mockResolvedValue(false);
    expect(await usecase.execute()).toBeNull();
    expect(decisions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'ABORT', reason: 'timeout' }),
    );
    expect(store.write).not.toHaveBeenCalled();
  });

  it('AI 제안이 실패해도 기간 초과 판정을 원장에 먼저 쓰고 정책을 갱신한다', async () => {
    const { usecase, store, decisions, planner } = setup();
    planner.propose.mockRejectedValue(new Error('model unavailable'));
    let saved: ReelFormatDecision | null = null;
    decisions.insert.mockImplementation(async (row) => {
      saved = decisionRow({ ...row, id: 'saved-1' });
      return true;
    });
    decisions.listAll.mockImplementation(async () => (saved ? [saved] : []));
    const report = await usecase.execute();
    expect(decisions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'ABORT',
        aiProposal: expect.objectContaining({ error: 'model unavailable' }),
      }),
    );
    expect(planner.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateIds: ['early_card=true'],
        reverseChallenge: false,
      }),
    );
    expect(store.write).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2 }),
    );
    expect(report?.reportedIds).toEqual(['saved-1']);
    expect(report?.text).toContain('AI 실패');
    expect(decisions.insert.mock.invocationCallOrder[0]).toBeLessThan(
      store.write.mock.invocationCallOrder[0],
    );
  });

  it('원장 삽입 뒤 정책 쓰기가 실패하면 다음 실행에서 이전 정책을 복구하고 판정을 보고한다', async () => {
    const { usecase, store, decisions } = setup();
    let saved: ReelFormatDecision | null = null;
    decisions.insert.mockImplementation(async (row) => {
      saved = decisionRow({ ...row, id: 'saved-after-write-failure' });
      return true;
    });
    decisions.listAll.mockImplementation(async () => (saved ? [saved] : []));
    store.write.mockRejectedValueOnce(new Error('policy write failed'));

    await expect(usecase.execute()).rejects.toThrow('policy write failed');
    expect(saved).not.toBeNull();
    expect(store.write).toHaveBeenCalledTimes(1);

    store.read.mockResolvedValue({ kind: 'ok', policy });
    const report = await usecase.execute();

    expect(store.write).toHaveBeenCalledWith(saved!.policyAfter);
    expect(report?.text).toContain(
      '릴스 형식 정책을 원장에서 v2으로 복구했습니다.',
    );
    expect(report?.text).toContain('릴스 형식 판정');
    expect(report?.reportedIds).toContain('saved-after-write-failure');
  });

  it('제안 모드의 PROMOTE는 챔피언을 바꾸지 않고 같은 대결을 다시 연다', async () => {
    const { usecase, store, decisions, posts, snapshots } = setup();
    const scored = scoredPosts();
    posts.listPublishedSince.mockResolvedValue(scored.posts);
    snapshots.listByPostIds.mockResolvedValue(scored.snapshots);
    decisions.insert.mockResolvedValue(false);

    await usecase.execute();

    expect(decisions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'PROMOTE',
        mode: 'PROPOSAL',
        policyAfter: expect.objectContaining({
          champion: { early_card: false },
          experiment: expect.objectContaining({ challenger: true }),
        }),
      }),
    );
    expect(store.write).not.toHaveBeenCalled();
  });

  it('이전 승격일부터 조회한 게시물도 현재 실험 시작 전에 게시됐으면 표본에서 제외한다', async () => {
    const { usecase, store, decisions, posts, snapshots } = setup();
    const scored = scoredPosts();
    scored.posts[0].publishedAt = new Date('2026-09-29T16:00:00Z');
    const firstArm = scored.posts[0].features!.experiment!.arm;
    posts.listPublishedSince.mockResolvedValue(scored.posts);
    snapshots.listByPostIds.mockResolvedValue(scored.snapshots);
    store.read.mockResolvedValue({
      kind: 'ok',
      policy: { ...policy, version: 2 },
    });
    decisions.listAll.mockResolvedValue([
      decisionRow({
        experimentId: 'previous-promotion',
        verdict: ReelFormatVerdict.PROMOTE,
        mode: ReelFormatDecisionMode.AUTO,
        decidedAt: new Date('2026-09-30T00:00:00Z'),
      }),
    ]);
    decisions.insert.mockResolvedValue(false);

    await usecase.execute();

    expect(posts.listPublishedSince).toHaveBeenCalledWith(
      new Date('2026-09-29T15:00:00Z'),
    );
    expect(decisions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: ReelFormatVerdict.ABORT,
        reason: 'timeout',
        nChampion: firstArm === 'champion' ? 5 : 6,
        nChallenger: firstArm === 'challenger' ? 5 : 6,
      }),
    );
  });

  it('제안 두 번 뒤 AUTO PROMOTE는 챔피언을 바꾸고 역도전을 연다', async () => {
    const { usecase, store, decisions, posts, snapshots } = setup();
    const scored = scoredPosts();
    store.read.mockResolvedValue({
      kind: 'ok',
      policy: { ...policy, version: 3 },
    });
    posts.listPublishedSince.mockResolvedValue(scored.posts);
    snapshots.listByPostIds.mockResolvedValue(scored.snapshots);
    decisions.listAll.mockResolvedValue([
      decisionRow({
        experimentId: 'proposal-1',
        verdict: ReelFormatVerdict.PROMOTE,
      }),
      decisionRow({
        experimentId: 'proposal-2',
        verdict: ReelFormatVerdict.KEEP,
      }),
    ]);
    decisions.insert.mockResolvedValue(false);

    await usecase.execute();

    expect(decisions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: ReelFormatVerdict.PROMOTE,
        mode: ReelFormatDecisionMode.AUTO,
        policyAfter: expect.objectContaining({
          champion: { early_card: true },
          experiment: expect.objectContaining({ challenger: false }),
        }),
        statsJson: expect.objectContaining({ nextReverseChallenge: true }),
      }),
    );
    expect(store.write).not.toHaveBeenCalled();
  });

  it('AI가 후보 밖 ID를 내면 대기열 첫 후보를 쓰고 오류를 원장에 남긴다', async () => {
    const { usecase, decisions, planner } = setup();
    planner.propose.mockResolvedValue({
      candidateId: 'unknown=true',
      hypothesis: '확인한다',
      interpretation: '후보를 바꾼다.',
      raw: '{"candidateId":"unknown=true"}',
    });
    decisions.insert.mockResolvedValue(false);

    await usecase.execute();

    expect(decisions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProposal: expect.objectContaining({
          error: expect.stringContaining('후보 밖 제안'),
        }),
        policyAfter: expect.objectContaining({
          experiment: expect.objectContaining({ challenger: true }),
        }),
      }),
    );
  });

  it.each([
    ['진행 실험 없음', null, null],
    ['진행 실험 있음', policy.experiment, policy.experiment!.id],
  ])(
    '최악 가드는 %s에도 챔피언을 이전 값으로 되돌린다',
    async (_label, experiment, interruptedId) => {
      const { usecase, store, decisions, posts, snapshots } = setup();
      const scored = worstGuardPosts();
      posts.listPublishedSince.mockResolvedValue(scored.posts);
      snapshots.listByPostIds.mockResolvedValue(scored.snapshots);
      const promoted = decisionRow({
        experimentId: 'promoted-1',
        verdict: ReelFormatVerdict.PROMOTE,
        mode: ReelFormatDecisionMode.AUTO,
        policyAfter: {
          ...policy,
          version: 2,
          champion: { early_card: true },
        },
        statsJson: { championMeanSkip: 60 },
        reportedAt: new Date('2026-10-20T00:00:00Z'),
      });
      decisions.listAll.mockResolvedValue([promoted]);
      decisions.insert.mockResolvedValue(false);
      store.read.mockResolvedValue({
        kind: 'ok',
        policy: {
          ...policy,
          version: 3,
          champion: { early_card: true },
          experiment,
        },
      });

      await usecase.execute();

      expect(decisions.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          experimentId: 'guard-promoted-1',
          verdict: 'ABORT',
          reason: 'worst_guard',
          policyAfter: expect.objectContaining({
            champion: { early_card: false },
          }),
          statsJson: expect.objectContaining({
            interruptedExperimentId: interruptedId,
          }),
        }),
      );
      expect(store.write).not.toHaveBeenCalled();
    },
  );
});
