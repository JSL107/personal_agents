import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  buildNextPolicy,
  collectSamples,
  DecisionHistoryRow,
  planRecovery,
  ReelFormatDecisionMode,
  ReelFormatVerdict,
} from './format-decision.policy';
import {
  assignArm,
  DEFAULT_FORMAT_VALUES,
  FORMAT_KNOBS,
  FormatPolicy,
  policyProblem,
} from './format-policy';
import {
  EMPTY_INSIGHT_METRICS,
  InsightSnapshot,
  SnapshotWindow,
} from './instagram-insight.type';
import {
  InstagramPost,
  InstagramPostField,
  InstagramPostStatus,
} from './instagram-post.type';
import { extractReelFeatures } from './reel-features';

const PYTHON_SCRIPT = `
import importlib.util, json, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location('hermes_skill_reels', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
payload = json.load(sys.stdin)
result = {
  'knobs': {key: list(values) for key, values in module.KNOBS.items()},
  'problems': [module.policy_problem(policy) for policy in payload['policies']],
  'arms': [module.assign_arm(entry['policy'], entry['day'])[0] for entry in payload['assignments']],
}
if payload.get('record'):
  with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    (root / module.POLICY_NAME).write_text(json.dumps(payload['record']['policy']), encoding='utf-8')
    out_dir = root / payload['record']['day']
    out_dir.mkdir()
    assignment = module.choose_assignment(out_dir, root, payload['record']['day'])
    result['record'] = module.experiment_record(assignment, {'points': [{'kind': 'point', 'start': 1.2}]})
json.dump(result, sys.stdout)
`;

type PythonParityOutput = {
  knobs: Record<string, Array<boolean | string | number>>;
  problems: string[];
  arms: string[];
  record?: Record<string, unknown>;
};

const runPython = (
  policies: unknown[],
  assignments: Array<{ policy: FormatPolicy; day: string }>,
  record?: { policy: FormatPolicy; day: string },
): PythonParityOutput => {
  const scriptPath = resolve(process.cwd(), 'scripts/hermes-skill-reels.py');
  const result = spawnSync(
    'python3',
    ['-I', '-B', '-c', PYTHON_SCRIPT, scriptPath],
    {
      input: JSON.stringify({ policies, assignments, record }),
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`python3 종료 ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as PythonParityOutput;
};

const basePolicy: FormatPolicy = {
  version: 1,
  frozen: false,
  champion: { ...DEFAULT_FORMAT_VALUES },
  experiment: {
    id: 'early_card-2026-11-10',
    knob: 'early_card',
    challenger: true,
    start: '2026-11-10',
  },
};

describe('Python 형식 정책 parity', () => {
  it('Python KNOBS 와 TS 후보 값이 일치하고 20개 넘는 정책의 오류 이유가 같다', () => {
    const nextPolicy = buildNextPolicy({
      policy: basePolicy,
      verdict: ReelFormatVerdict.KEEP,
      mode: ReelFormatDecisionMode.PROPOSAL,
      candidate: {
        knob: 'early_card',
        challenger: true,
        id: 'early_card=true',
      },
      today: '2026-11-14',
    });
    const promotedPolicy = buildNextPolicy({
      policy: basePolicy,
      verdict: ReelFormatVerdict.PROMOTE,
      mode: ReelFormatDecisionMode.AUTO,
      candidate: {
        knob: 'early_card',
        challenger: false,
        id: 'early_card=false',
      },
      today: '2026-11-14',
    });
    const recovery = planRecovery({
      state: { kind: 'missing' },
      latest: {
        policyAfter: nextPolicy,
        policyVersionAfter: nextPolicy.version,
      } as DecisionHistoryRow,
    });
    const policies: unknown[] = [
      basePolicy,
      nextPolicy,
      promotedPolicy,
      recovery,
      { ...basePolicy, experiment: null },
      { ...basePolicy, frozen: true },
      { ...basePolicy, version: 2 },
      { ...basePolicy, version: 0 },
      { ...basePolicy, version: -1 },
      { ...basePolicy, version: true },
      { ...basePolicy, frozen: 0 },
      { ...basePolicy, champion: { early_card: true }, experiment: null },
      { ...basePolicy, champion: { early_card: 0 } },
      { ...basePolicy, champion: { early_card: 'false' } },
      { ...basePolicy, champion: {} },
      { ...basePolicy, champion: { early_card: false, extra: true } },
      { ...basePolicy, extra: 1 },
      { ...basePolicy, experiment: {} },
      { ...basePolicy, experiment: { ...basePolicy.experiment, id: '' } },
      {
        ...basePolicy,
        experiment: { ...basePolicy.experiment, knob: 'unknown' },
      },
      {
        ...basePolicy,
        experiment: { ...basePolicy.experiment, challenger: false },
      },
      {
        ...basePolicy,
        experiment: { ...basePolicy.experiment, challenger: 1 },
      },
      {
        ...basePolicy,
        experiment: { ...basePolicy.experiment, start: '2026-02-30' },
      },
      {
        ...basePolicy,
        experiment: { ...basePolicy.experiment, start: '2026-2-3' },
      },
      { ...basePolicy, experiment: { ...basePolicy.experiment, start: null } },
      { ...basePolicy, experiment: { ...basePolicy.experiment, extra: true } },
      null,
      [],
      'broken',
    ];
    const python = runPython(policies, []);
    expect(python.knobs).toEqual(FORMAT_KNOBS);
    expect(policies.map(policyProblem)).toEqual(python.problems);
  });

  it('연 경계와 윤년을 포함한 40일씩 세 실험 id에서 매일 같은 군으로 배정한다', () => {
    const assignments: Array<{ policy: FormatPolicy; day: string }> = [];
    for (const start of ['2026-12-20', '2028-02-15']) {
      for (const id of ['alpha', 'beta', 'gamma']) {
        const policy: FormatPolicy = {
          ...basePolicy,
          experiment: { id, knob: 'early_card', challenger: true, start },
        };
        const startDate = new Date(`${start}T00:00:00.000Z`);
        for (let offset = -2; offset < 40; offset += 1) {
          const date = new Date(startDate.getTime() + offset * 86_400_000);
          assignments.push({ policy, day: date.toISOString().slice(0, 10) });
        }
      }
    }
    const python = runPython([], assignments);
    const actual = assignments.map(
      ({ policy, day }) => assignArm({ policy: policy, day: day }).arm,
    );
    expect(actual).toEqual(python.arms);
  });

  it('TS가 거부하는 Python 확장 날짜 표기는 알려진 안전 방향 차이로 고정한다', () => {
    const policy = {
      ...basePolicy,
      experiment: { ...basePolicy.experiment, start: '20261110' },
    };
    const python = runPython([policy], []);
    expect(python.problems).toEqual(['']);
    expect(policyProblem(policy)).toBe('experiment');
  });

  it('Python 배정·실현 기록을 TS 릴스 feature로 옮긴다', () => {
    const day = ['2026-11-10', '2026-11-11'].find(
      (candidate) =>
        assignArm({ policy: basePolicy, day: candidate }).arm === 'challenger',
    );
    expect(day).toBeDefined();
    const python = runPython([], [], {
      policy: basePolicy,
      day: day as string,
    });
    const script = {
      duration: 52,
      segments: [
        {
          field: 'ai',
          segment: {
            headline: '형식 실험',
            lines: [
              {
                subtitle: '첫 줄',
                speech: '첫 줄',
                gesture: 'idle',
                react: 'none',
                point_kind: 'point',
              },
            ],
          },
        },
      ],
      experiment: python.record,
    };
    const features = extractReelFeatures({ script, folderField: 'daily' });
    expect(features?.experiment).toMatchObject({
      experimentId: basePolicy.experiment?.id,
      knob: 'early_card',
      arm: 'challenger',
      values: { early_card: true },
      realized: true,
    });
    const post = {
      id: 'post-1',
      reelKey: `${day}/daily`,
      field: InstagramPostField.DAILY,
      status: InstagramPostStatus.PUBLISHED,
      publishedAt: new Date(`${day}T03:00:00.000Z`),
      features,
    } as InstagramPost;
    const snapshot = {
      id: 'snapshot-1',
      postId: post.id,
      snapshotWindow: SnapshotWindow.AFTER_3_DAYS,
      ageMinutes: 4_320,
      metrics: {
        ...EMPTY_INSIGHT_METRICS,
        views: 80,
        skipRate: 72,
        avgWatchMs: 2_000,
      },
      error: null,
    } as InsightSnapshot;
    const samples = collectSamples({
      policy: basePolicy,
      posts: [post],
      snapshots: [snapshot],
      today: '2026-11-15',
      now: new Date('2026-11-15T00:00:00.000Z'),
    });
    expect(samples.challenger).toMatchObject([
      {
        reelKey: `${day}/daily`,
        snapshotId: 'snapshot-1',
        arm: 'challenger',
        skipRate: 72,
      },
    ]);
  });
});
