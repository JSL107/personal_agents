import { AgentType } from '../../model-router/domain/model-router.type';
import { NL_ANSWER_EVAL_CASES } from './nl-answer-eval.cases';
import {
  scoreRun,
  summarizeCase,
  summarizeSplits,
} from './nl-answer-eval.scorer';
import { EvalCase, EvalRunRecord } from './nl-answer-eval.type';

const run = (overrides: Partial<EvalRunRecord>): EvalRunRecord => ({
  caseId: 'c',
  split: 'tuning',
  runIndex: 0,
  outcome: 'WORKER_RAN',
  destination: AgentType.VACATION,
  text: '',
  intercepts: [],
  modelCalls: [],
  durationMs: 0,
  ...overrides,
});

const evalCase = (
  expect: EvalCase['expect'],
  extra: Partial<EvalCase> = {},
): EvalCase => ({
  id: 'c',
  split: 'tuning',
  note: '',
  text: '질문',
  expect,
  ...extra,
});

describe('scoreRun', () => {
  it('출처·금지 실행·필요 표현이 모두 맞으면 통과', () => {
    const score = scoreRun(
      evalCase({
        destinations: [AgentType.VACATION],
        forbidIntercepts: true,
        mustMatch: [/4\s*일/],
      }),
      run({ text: '부여 8일 기준이면 잔여 4일이에요.' }),
    );
    expect(score).toEqual({ pass: true, failures: [] });
  });

  it('금지된 쓰기 시도는 실패', () => {
    const score = scoreRun(
      evalCase({ forbidIntercepts: true }),
      run({
        outcome: 'INTERCEPTED',
        intercepts: [{ name: 'RegisterLeaveUsecase', args: {} }],
      }),
    );
    expect(score.pass).toBe(false);
    expect(score.failures[0]).toContain('RegisterLeaveUsecase');
  });

  it('대조군은 기대한 실행이 인자까지 맞아야 통과', () => {
    const expectReview = evalCase({
      mustIntercept: {
        name: 'ReviewPullRequestUsecase',
        argsInclude: { repo: 'o/r', number: 1 },
      },
    });
    expect(
      scoreRun(
        expectReview,
        run({
          outcome: 'INTERCEPTED',
          intercepts: [
            {
              name: 'ReviewPullRequestUsecase',
              args: { repo: 'o/r', number: 1 },
            },
          ],
        }),
      ).pass,
    ).toBe(true);
    expect(
      scoreRun(
        expectReview,
        run({ outcome: 'ERROR', text: 'PR 참조 형식이 잘못되었습니다' }),
      ).pass,
    ).toBe(false);
  });

  it.each([
    '어느 서비스나 고객사의 가상계좌를 조회하면 될까요?',
    '타인의 비공개 금융정보 조회는 어려워요.',
    '사용법: `/휴가 사용 2026-07-01` 로 등록하세요',
    '/review-pr 로 요청해 주세요',
  ])('범용 챗봇 표현 "%s" 은 어느 문항이든 실패', (text) => {
    expect(scoreRun(evalCase({}), run({ text })).pass).toBe(false);
  });

  it('URL 경로의 슬래시는 슬래시 명령으로 보지 않는다', () => {
    expect(
      scoreRun(
        evalCase({}),
        run({ text: '<https://github.com/o/r/pull/1> 리뷰 결과입니다' }),
      ).pass,
    ).toBe(true);
  });

  it('되묻기로 끝나면 실패', () => {
    const score = scoreRun(
      evalCase({ notEndWithQuestion: true }),
      run({
        outcome: 'REPLIED',
        destination: 'REPLIED',
        text: '어떤 부분이 궁금하세요?',
      }),
    );
    expect(score.failures).toContain('되묻기로 끝남');
  });

  it('직전 봇 응답을 꼬리표만 바꿔 되풀이하면 실패', () => {
    const score = scoreRun(
      evalCase(
        { differFromPriorBot: true },
        {
          priorTurns: [
            {
              role: 'assistant',
              text: '잔여 2일 _이대리 (VACATION) · agentRunId=1_',
              agentType: AgentType.VACATION,
              agentRunId: 1,
              timestampMs: 0,
            },
          ],
        },
      ),
      run({ text: '잔여 2일 _이대리 (VACATION) · agentRunId=2_' }),
    );
    expect(score.failures).toContain('직전 봇 응답을 그대로 되풀이');
  });

  it('텍스트 검사가 있는 문항에서 가로채거나 오류로 끝난 회차는 실패', () => {
    const c = evalCase({ mustMatch: [/4/] });
    expect(
      scoreRun(c, run({ outcome: 'INTERCEPTED', text: undefined })).pass,
    ).toBe(false);
    expect(scoreRun(c, run({ outcome: 'ERROR', text: '오류' })).pass).toBe(
      false,
    );
  });

  it('실행하지 않는 워커로 간 회차는 문항이 그 워커를 허용했을 때만 통과한다', () => {
    const stub = run({
      outcome: 'STUB_ROUTED',
      destination: AgentType.BLOG,
      text: undefined,
    });
    // 허용 목록이 없으면 답을 판정할 수 없으므로 실패 — 판정 안 한 회차가 점수를 부풀리지 않게.
    expect(scoreRun(evalCase({ notEndWithQuestion: true }), stub).pass).toBe(
      false,
    );
    expect(
      scoreRun(
        evalCase({
          notEndWithQuestion: true,
          acceptStubRoutes: [AgentType.BLOG],
        }),
        stub,
      ).pass,
    ).toBe(true);
    expect(
      scoreRun(
        evalCase({
          notEndWithQuestion: true,
          acceptStubRoutes: [AgentType.PM],
        }),
        stub,
      ).pass,
    ).toBe(false);
  });
});

describe('summarizeCase', () => {
  it('3회 중 2회 통과면 충족, 1회면 미충족', () => {
    const c = evalCase({ mustMatch: [/ok/] });
    expect(
      summarizeCase(c, [
        run({ text: 'ok' }),
        run({ text: 'ok' }),
        run({ text: 'no' }),
      ]).satisfied,
    ).toBe(true);
    expect(
      summarizeCase(c, [
        run({ text: 'ok' }),
        run({ text: 'no' }),
        run({ text: 'no' }),
      ]).satisfied,
    ).toBe(false);
  });

  it('split 별로 충족 문항 수를 센다', () => {
    const summaries = summarizeSplits([
      {
        caseId: 'a',
        split: 'tuning',
        runs: 1,
        passes: 1,
        stubRouted: 0,
        satisfied: true,
        failures: [],
      },
      {
        caseId: 'b',
        split: 'holdout',
        runs: 1,
        passes: 0,
        stubRouted: 0,
        satisfied: false,
        failures: [],
      },
    ]);
    expect(summaries).toEqual([
      { split: 'tuning', cases: 1, satisfied: 1 },
      { split: 'holdout', cases: 1, satisfied: 0 },
    ]);
  });
});

describe('NL_ANSWER_EVAL_CASES', () => {
  it('문항 id 는 겹치지 않는다', () => {
    const ids = NL_ANSWER_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('튜닝 20개 이상, holdout 12개 이상, 합계 30개 이상', () => {
    const tuning = NL_ANSWER_EVAL_CASES.filter((c) => c.split === 'tuning');
    const holdout = NL_ANSWER_EVAL_CASES.filter((c) => c.split === 'holdout');
    expect(tuning.length).toBeGreaterThanOrEqual(20);
    expect(holdout.length).toBeGreaterThanOrEqual(12);
    expect(NL_ANSWER_EVAL_CASES.length).toBeGreaterThanOrEqual(30);
  });

  it('id 접두사가 split 과 맞는다', () => {
    for (const c of NL_ANSWER_EVAL_CASES) {
      expect(c.id.startsWith(c.split === 'tuning' ? 't-' : 'h-')).toBe(true);
    }
  });
});
