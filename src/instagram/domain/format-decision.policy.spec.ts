import {
  buildNextPolicy,
  checkWorstGuard,
  collectSamples,
  decideMode,
  DecisionHistoryRow,
  judgeExperiment,
  listCandidates,
  permutationPValue,
  planRecovery,
  ReelFormatDecisionMode,
  ReelFormatVerdict,
  SampleCollection,
  ScoredSample,
} from './format-decision.policy';
import { FormatPolicy } from './format-policy';
import { InsightSnapshot, SnapshotWindow } from './instagram-insight.type';
import { InstagramPost, InstagramPostStatus } from './instagram-post.type';

const POLICY: FormatPolicy = {
  version: 1,
  frozen: false,
  champion: { early_card: false },
  experiment: {
    id: 'early_card-2026-11-01',
    knob: 'early_card',
    challenger: true,
    start: '2026-11-01',
  },
};
const sample = (
  arm: 'champion' | 'challenger',
  index: number,
  skipRate: number,
  avgWatchMs: number | null = 5000,
): ScoredSample => ({
  day: `2026-11-${String(index + 1).padStart(2, '0')}`,
  reelKey: `2026-11-${String(index + 1).padStart(2, '0')}/daily`,
  snapshotId: `${arm}-${index}`,
  ageMinutes: 5000,
  arm,
  skipRate,
  avgWatchMs,
});
const collection = (
  championSkip = 80,
  challengerSkip = 70,
): SampleCollection => ({
  champion: Array.from({ length: 6 }, (_, index) =>
    sample('champion', index, championSkip),
  ),
  challenger: Array.from({ length: 6 }, (_, index) =>
    sample('challenger', index, challengerSkip),
  ),
  pendingDays: [],
  excluded: {
    lost: 0,
    error: 0,
    skip_null: 0,
    watch_null: 0,
    low_views: 0,
    no_record: 0,
    arm_mismatch: 0,
    value_mismatch: 0,
    unrealized: 0,
  },
  publishRates: {
    championAssigned: 6,
    challengerAssigned: 6,
    championPublished: 6,
    challengerPublished: 6,
    championRate: 100,
    challengerRate: 100,
    gapPoints: 0,
  },
});
const history = (
  patch: Partial<DecisionHistoryRow> = {},
): DecisionHistoryRow => ({
  experimentId: 'old',
  knob: 'early_card',
  championValue: false,
  challengerValue: true,
  verdict: ReelFormatVerdict.KEEP,
  mode: ReelFormatDecisionMode.PROPOSAL,
  reverseChallenge: false,
  policyVersionAfter: 2,
  policyAfter: POLICY,
  statsJson: { championMeanSkip: 70 },
  createdAt: new Date('2026-11-01'),
  ...patch,
});
const post = (day: string, patch: Partial<InstagramPost> = {}): InstagramPost =>
  ({
    id: day,
    reelKey: `${day}/daily`,
    status: InstagramPostStatus.PUBLISHED,
    publishedAt: new Date(`${day}T00:00:00Z`),
    features: {
      experiment: {
        policyVersion: 1,
        source: 'policy',
        experimentId: POLICY.experiment!.id,
        knob: 'early_card',
        arm: 'champion',
        values: { early_card: false },
        realized: true,
        checks: {},
      },
    },
    ...patch,
  }) as InstagramPost;
const snapshot = (
  day: string,
  patch: Partial<InsightSnapshot> = {},
): InsightSnapshot =>
  ({
    id: `snap-${day}`,
    postId: day,
    snapshotWindow: SnapshotWindow.AFTER_3_DAYS,
    ageMinutes: 5000,
    metrics: { views: 100, skipRate: 70, avgWatchMs: 5000 },
    error: null,
    ...patch,
  }) as InsightSnapshot;

describe('permutationPValue', () => {
  it('완전히 분리된 6편씩이면 924개 순열 중 한 가지가 관측값 이상이다', () => {
    expect(
      permutationPValue({
        champion: [80, 80, 80, 80, 80, 80],
        challenger: [70, 70, 70, 70, 70, 70],
      }),
    ).toBe(1 / 924);
  });
  it('모든 skip 값이 같으면 모든 순열이 관측값 이상이다', () => {
    expect(
      permutationPValue({
        champion: [70, 70, 70, 70, 70, 70],
        challenger: [70, 70, 70, 70, 70, 70],
      }),
    ).toBe(1);
  });
});

describe('judgeExperiment', () => {
  it('승격 조건과 정확한 6%p·400ms 경계를 통과한다', () => {
    const samples = collection(80, 74);
    samples.challenger.forEach((item) => {
      item.avgWatchMs = 4600;
    });
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).verdict,
    ).toBe(ReelFormatVerdict.PROMOTE);
  });
  it('5.99%p 차이와 시청 401ms 감소이면 유지한다', () => {
    expect(
      judgeExperiment({
        policy: POLICY,
        samples: collection(80, 74.01),
        today: '2026-11-20',
      }).verdict,
    ).toBe(ReelFormatVerdict.KEEP);
    const samples = collection();
    samples.challenger.forEach((item) => {
      item.avgWatchMs = 4599;
    });
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).reason,
    ).toBe('watch_guard');
  });
  it('평균 시청이 모두 null이면 유지하고 사유를 남긴다', () => {
    const samples = collection();
    samples.champion.forEach((item) => {
      item.avgWatchMs = null;
    });
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).reason,
    ).toBe('watch_missing');
  });
  it('게시율 차이가 15%p 초과이면 보류하고 정확히 15는 통과한다', () => {
    const samples = collection();
    samples.publishRates.gapPoints = 16;
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).verdict,
    ).toBe(ReelFormatVerdict.HOLD);
    samples.publishRates.gapPoints = 15;
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).verdict,
    ).toBe(ReelFormatVerdict.PROMOTE);
  });
  it('6편 미달은 대기하다 31일째 중단하며 게시율 차이도 남긴다', () => {
    const samples = collection();
    samples.challenger.pop();
    samples.publishRates.gapPoints = 16;
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).verdict,
    ).toBeNull();
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-12-02' }).reason,
    ).toContain('publish_gap');
  });
  it('7편째는 쓰지 않고 앞선 pending은 판정을 미룬다', () => {
    const samples = collection();
    samples.champion.push(sample('champion', 7, 0));
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).stats
        .championMeanSkip,
    ).toBe(80);
    samples.pendingDays.push('2026-11-01');
    expect(
      judgeExperiment({ policy: POLICY, samples, today: '2026-11-20' }).reason,
    ).toBe('earlier_pending');
  });
});

describe('candidate and mode policies', () => {
  it('제안 두 번은 승격을 적용하지 않고 다음 실험은 시작한다', () => {
    expect(
      decideMode([
        history(),
        history({ experimentId: 'hold', verdict: ReelFormatVerdict.HOLD }),
      ]),
    ).toBe(ReelFormatDecisionMode.PROPOSAL);
    expect(decideMode([history(), history({ experimentId: 'second' })])).toBe(
      ReelFormatDecisionMode.AUTO,
    );
    const next = buildNextPolicy({
      policy: POLICY,
      verdict: ReelFormatVerdict.PROMOTE,
      mode: ReelFormatDecisionMode.PROPOSAL,
      candidate: {
        knob: 'early_card',
        challenger: true,
        id: 'early_card=true',
      },
      today: '2026-11-20',
    });
    expect(next.champion.early_card).toBe(false);
    expect(next.experiment?.start).toBe('2026-11-21');
  });
  it('AUTO 승격은 역도전을 먼저 선택하고 같은 쌍을 두 번 넘게 쓰지 않는다', () => {
    const promoted = history({
      verdict: ReelFormatVerdict.PROMOTE,
      mode: ReelFormatDecisionMode.AUTO,
    });
    const switched: FormatPolicy = {
      ...POLICY,
      champion: { early_card: true },
    };
    const candidates = listCandidates({ policy: switched, rows: [promoted] });
    expect(candidates.reverseChallenge).toBe(true);
    expect(candidates.candidates[0].challenger).toBe(false);
    expect(
      listCandidates({
        policy: switched,
        rows: [
          promoted,
          history({
            experimentId: 'reverse',
            championValue: true,
            challengerValue: false,
            mode: ReelFormatDecisionMode.AUTO,
            reverseChallenge: true,
          }),
        ],
      }).candidates,
    ).toEqual([]);
  });
  it('같은 쌍의 보류와 중단이 연속이면 후보를 제외한다', () => {
    const rows = [
      history({ verdict: ReelFormatVerdict.HOLD }),
      history({ experimentId: 'abort', verdict: ReelFormatVerdict.ABORT }),
    ];
    expect(listCandidates({ policy: POLICY, rows }).needsHumanReview).toBe(
      true,
    );
    expect(listCandidates({ policy: POLICY, rows }).candidates).toEqual([]);
  });
});

describe('collectSamples', () => {
  it('스토리와 옛 분야를 무시하고 기록 불일치와 유실을 제외한다', () => {
    const posts = [
      post('2026-11-01'),
      post('2026-11-02', { reelKey: '2026-11-02/story' }),
      post('2026-11-03', { reelKey: '2026-11-03/ai' }),
      post('2026-11-04'),
      post('2026-11-05', { features: null }),
    ];
    const snapshots = [snapshot('2026-11-01'), snapshot('2026-11-05')];
    const result = collectSamples({
      policy: POLICY,
      posts,
      snapshots,
      today: '2026-11-10',
      now: new Date('2026-11-20'),
    });
    expect(result.champion.length + result.challenger.length).toBe(1);
    expect(result.excluded.lost).toBe(1);
    expect(result.excluded.no_record).toBe(1);
  });
  it('평균 시청이 비어 있는 영상은 watch_null 로 제외한다', () => {
    const result = collectSamples({
      policy: POLICY,
      posts: [post('2026-11-01')],
      snapshots: [
        snapshot('2026-11-01', {
          metrics: {
            views: 100,
            skipRate: 70,
            avgWatchMs: null,
          } as InsightSnapshot['metrics'],
        }),
      ],
      today: '2026-11-10',
      now: new Date('2026-11-20'),
    });
    expect(result.champion.length + result.challenger.length).toBe(0);
    expect(result.excluded.watch_null).toBe(1);
  });
  it('arm과 실현값 불일치를 각각 제외한다', () => {
    const posts = [
      post('2026-11-01', {
        features: {
          experiment: {
            policyVersion: 1,
            source: 'policy',
            experimentId: POLICY.experiment!.id,
            knob: 'early_card',
            arm: 'challenger',
            values: { early_card: false },
            realized: true,
            checks: {},
          },
        } as unknown as InstagramPost['features'],
      }),
      post('2026-11-02', {
        features: {
          experiment: {
            policyVersion: 1,
            source: 'policy',
            experimentId: POLICY.experiment!.id,
            knob: 'early_card',
            arm: 'champion',
            values: { early_card: true },
            realized: true,
            checks: {},
          },
        } as unknown as InstagramPost['features'],
      }),
    ];
    const result = collectSamples({
      policy: POLICY,
      posts,
      snapshots: [snapshot('2026-11-01'), snapshot('2026-11-02')],
      today: '2026-11-10',
      now: new Date('2026-11-20'),
    });
    expect(result.excluded.arm_mismatch + result.excluded.value_mismatch).toBe(
      2,
    );
  });
});

describe('worst guard', () => {
  it('승격 후 12%p는 유지하고 12.01%p는 복귀한다', () => {
    const promoted = history({
      verdict: ReelFormatVerdict.PROMOTE,
      mode: ReelFormatDecisionMode.AUTO,
      policyVersionAfter: 2,
    });
    const policy: FormatPolicy = {
      ...POLICY,
      champion: { early_card: true },
      experiment: null,
    };
    const posts = ['01', '02', '03', '04'].map((date) =>
      post(`2026-11-${date}`, {
        features: {
          experiment: {
            policyVersion: 2,
            source: 'policy',
            experimentId: null,
            knob: null,
            arm: 'champion',
            values: { early_card: true },
            realized: true,
            checks: {},
          },
        } as unknown as InstagramPost['features'],
      }),
    );
    const snapshots = posts.map((item) =>
      snapshot(item.id, {
        metrics: { views: 100, skipRate: 82, avgWatchMs: 5000 },
      } as InsightSnapshot),
    );
    const input = {
      policy,
      rows: [promoted],
      posts,
      snapshots,
      today: '2026-11-10',
      now: new Date('2026-11-10'),
    };
    expect(checkWorstGuard(input)?.shouldRevert).toBe(false);
    snapshots[0].metrics.skipRate = 82.04;
    expect(checkWorstGuard(input)?.shouldRevert).toBe(true);
    expect(checkWorstGuard({ ...input, posts: posts.slice(0, 3) })).toBeNull();
    expect(checkWorstGuard({ ...input, policy: POLICY })).toBeNull();
  });
  it('낡은 정책 버전 영상은 제외하고 앞선 미수집 영상이 있으면 기다린다', () => {
    const promoted = history({
      verdict: ReelFormatVerdict.PROMOTE,
      mode: ReelFormatDecisionMode.AUTO,
      policyVersionAfter: 3,
    });
    const policy: FormatPolicy = {
      ...POLICY,
      champion: { early_card: true },
      experiment: null,
    };
    const posts = ['01', '02', '03', '04', '05'].map((date, index) =>
      post(`2026-11-${date}`, {
        features: {
          experiment: {
            policyVersion: index === 0 ? 2 : 3,
            source: 'policy',
            experimentId: null,
            knob: null,
            arm: 'champion',
            values: { early_card: true },
            realized: true,
            checks: {},
          },
        } as unknown as InstagramPost['features'],
      }),
    );
    const snapshots = posts.slice(1).map((item) =>
      snapshot(item.id, {
        metrics: { views: 100, skipRate: 90, avgWatchMs: 5000 },
      } as InsightSnapshot),
    );
    const input = {
      policy,
      rows: [promoted],
      posts,
      snapshots,
      today: '2026-11-10',
      now: new Date('2026-11-07'),
    };
    expect(checkWorstGuard(input)?.shouldRevert).toBe(true);
    posts[0].features!.experiment!.policyVersion = 3;
    expect(checkWorstGuard(input)).toBeNull();
  });
});

describe('planRecovery', () => {
  it('파일이 없으면 최근 원장의 policyAfter를 그대로 복구한다', () => {
    const older = history({
      policyVersionAfter: 2,
      createdAt: new Date('2026-11-01'),
    });
    const latestPolicy: FormatPolicy = {
      ...POLICY,
      version: 3,
      experiment: null,
    };
    const latest = history({
      experimentId: 'latest',
      policyVersionAfter: 3,
      policyAfter: latestPolicy,
      createdAt: new Date('2026-11-02'),
    });
    expect(
      planRecovery({ policy: null, missing: true, rows: [latest, older] }),
    ).toBe(latestPolicy);
    expect(
      planRecovery({
        policy: latestPolicy,
        missing: false,
        rows: [latest, older],
      }),
    ).toBeNull();
  });
});
