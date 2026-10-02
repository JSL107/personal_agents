import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import {
  isQuantitativeShownInDigest,
  PoEvalAutopilotTask,
} from './po-eval.autopilot-task';

const makeAgentRunService = (runs: unknown[] = []) =>
  ({
    findRecentSucceededRuns: jest.fn().mockResolvedValue(runs),
  }) as never;

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };
const makeHumanizeService = (): HumanizeService =>
  ({
    humanize: jest
      .fn()
      .mockImplementation(async (fields: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, `${value}_H`]),
        ),
      ),
  }) as unknown as HumanizeService;

describe('PoEvalAutopilotTask', () => {
  it('id 는 daily-eval', () => {
    const task = new PoEvalAutopilotTask(
      {} as never,
      makeHumanizeService(),
      makeAgentRunService(),
    );
    expect(task.id).toBe('daily-eval');
  });

  it('PO_EVAL 성공 시 요약은 summaryText, 근거(careerLog·합성 source)는 detailText 로 분리(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: {
        range: 'TODAY',
        sourceAgentRuns: { workReviewerRunId: 10 },
        qualitative: { summary: '회고요약', blockers: [], wins: [] },
        careerLog: {
          schemaVersion: 1,
          period: '2026-06-17',
          achievements: { quantitative: [], qualitative: [] },
          technologies: [],
          impact: '오늘 핵심 활동.',
        },
      },
      modelUsed: 'claude-cli',
      agentRunId: 50,
    });
    const task = new PoEvalAutopilotTask(
      { execute } as never,
      makeHumanizeService(),
      makeAgentRunService(),
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('Daily Eval');
    expect(out.summaryText).toContain('회고요약_H');
    // 근거(합성 source · careerLog · model 푸터)는 스레드(detailText)로 내려가고 메인에는 없다.
    expect(out.summaryText).not.toContain('합성 source');
    expect(out.detailText).toContain('합성 source');
    expect(out.detailText).toContain('workReviewer=#10');
    expect(out.detailText).toContain('careerLog');
    expect(out.detailText).toContain('오늘 핵심 활동._H');
    expect(out.detailText).toContain('run #50');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', range: 'TODAY' }),
    );
  });

  it('NO_SUB_AGENT_RUNS 면 skip 안내문(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new PoEvalException({
        code: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
        message: '없음',
        status: DomainStatus.NOT_FOUND,
      }),
    );
    const task = new PoEvalAutopilotTask(
      { execute } as never,
      makeHumanizeService(),
      makeAgentRunService(),
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('skip');
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const task = new PoEvalAutopilotTask(
      { execute } as never,
      makeHumanizeService(),
      makeAgentRunService(),
    );
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });

  // 저녁 다이제스트에서 업무 회고 「정량 근거」와 careerLog 「정량 성과」가 같은 숫자를 두 번 싣던 것.
  describe('careerLog 정량 성과 — 같은 메시지에 이미 나간 숫자는 다시 싣지 않는다', () => {
    const NOW = new Date('2026-06-17T10:05:00Z');
    const worklogRun = (overrides: Record<string, unknown> = {}) => ({
      id: 10,
      output: { impact: { quantitative: ['PR 28건 머지'] } },
      endedAt: new Date('2026-06-17T10:01:00Z'),
      inputSnapshot: {},
      ...overrides,
    });

    it('같은 run · 방금 끝남 · 정량 근거 있음 → 생략', () => {
      expect(isQuantitativeShownInDigest(10, worklogRun(), NOW)).toBe(true);
    });

    it.each([
      ['합성에 쓴 run 이 최신이 아니다', 10, worklogRun({ id: 11 })],
      [
        '오래전에 끝난 run 이다(오늘 저녁 업무 회고가 실패한 회차)',
        10,
        worklogRun({ endedAt: new Date('2026-06-17T05:00:00Z') }),
      ],
      [
        '업무 회고에 정량 근거가 없다',
        10,
        worklogRun({ output: { impact: { quantitative: [] } } }),
      ],
      ['업무 회고 run 을 못 찾았다', 10, undefined],
      ['PO 평가가 업무 회고를 안 썼다', undefined, worklogRun()],
    ])('%s → 그대로 싣는다', (_label, runId, run) => {
      expect(
        isQuantitativeShownInDigest(
          runId as number | undefined,
          run as never,
          NOW,
        ),
      ).toBe(false);
    });

    const evaluation = {
      range: 'TODAY',
      sourceAgentRuns: { workReviewerRunId: 10 },
      qualitative: { summary: '요약', blockers: [], wins: [] },
      careerLog: {
        schemaVersion: 1,
        period: '2026-06-17',
        achievements: {
          quantitative: ['PR 28건 머지', '8,552줄'],
          qualitative: ['Router 도입 완료'],
        },
        technologies: [],
        impact: '',
      },
    };

    it('조건이 맞으면 정량 성과 목록 대신 안내 한 줄만 남기고 정성 성과는 유지한다', async () => {
      const task = new PoEvalAutopilotTask(
        {
          execute: jest.fn().mockResolvedValue({
            result: evaluation,
            modelUsed: 'codex',
            agentRunId: 50,
          }),
        } as never,
        makeHumanizeService(),
        makeAgentRunService([
          {
            id: 10,
            output: { impact: { quantitative: ['PR 28건 머지'] } },
            endedAt: new Date(),
            inputSnapshot: {},
          },
        ]),
      );

      const out = await task.run(CTX);

      expect(out.detailText).not.toContain('*정량 성과*');
      expect(out.detailText).not.toContain('8,552줄');
      expect(out.detailText).toContain(
        '정량 성과 2건은 업무 회고(run #10) 「정량 근거」와 같은 근거라',
      );
      expect(out.detailText).toContain('*정성 성과*');
    });

    it('업무 회고 run 이 다르면 정량 성과를 그대로 싣는다', async () => {
      const task = new PoEvalAutopilotTask(
        {
          execute: jest.fn().mockResolvedValue({
            result: evaluation,
            modelUsed: 'codex',
            agentRunId: 50,
          }),
        } as never,
        makeHumanizeService(),
        makeAgentRunService([
          {
            id: 99,
            output: { impact: { quantitative: ['x'] } },
            endedAt: new Date(),
            inputSnapshot: {},
          },
        ]),
      );

      const out = await task.run(CTX);

      expect(out.detailText).toContain('*정량 성과*');
    });
  });
});
