import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import {
  findQuantitativeShownInDigest,
  isCoveredByWorklog,
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

  it('PO_EVAL 성공 시 메인은 건수 한 줄, 평가 요약·Wins·Blockers·근거는 모두 detailText(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: {
        range: 'TODAY',
        sourceAgentRuns: { workReviewerRunId: 10 },
        qualitative: {
          summary: '회고요약',
          blockers: ['스모크 공백'],
          wins: ['PR 28건', '문서 정정'],
        },
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
    // 저녁 메인 중복의 원천이라 메인에는 건수만 남기고 내용은 스레드 맨 앞으로 옮긴다.
    expect(out.summaryText).toContain('Wins 2 · Blockers 1');
    expect(out.summaryText).not.toContain('회고요약_H');
    expect(out.summaryText).not.toContain('PR 28건');
    expect(out.summaryText).not.toContain('스모크 공백');
    expect(out.detailText).toContain('회고요약_H');
    expect(out.detailText).toContain('PR 28건_H');
    expect(out.detailText).toContain('스모크 공백_H');
    expect(out.detailText!.indexOf('Wins')).toBeLessThan(
      out.detailText!.indexOf('careerLog'),
    );
    // 메인엔 건수뿐이라 상세가 유일한 사본 — 스레드 실패 시 채널 대피 대상이어야 한다.
    expect(out.detailIsOnlyCopy).toBe(true);
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
      triggerType: TriggerType.DAILY_EVAL_CRON,
      ...overrides,
    });

    it('같은 run · 저녁 자동 실행 · 방금 끝남 · 정량 근거 있음 → 그 목록을 돌려준다', () => {
      expect(
        findQuantitativeShownInDigest(10, worklogRun() as never, NOW),
      ).toEqual(['PR 28건 머지']);
    });

    it.each([
      ['합성에 쓴 run 이 최신이 아니다', 10, worklogRun({ id: 11 })],
      [
        '30분 안에 끝난 수동 /worklog 다(오늘 저녁 업무 회고는 실패)',
        10,
        worklogRun({ triggerType: TriggerType.SLACK_COMMAND_WORKLOG }),
      ],
      [
        '오래전에 끝난 run 이다',
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
    ])('%s → null(그대로 싣는다)', (_label, runId, run) => {
      expect(
        findQuantitativeShownInDigest(
          runId as number | undefined,
          run as never,
          NOW,
        ),
      ).toBeNull();
    });

    it.each([
      ['숫자가 모두 업무 회고에 있다', 'PR 28건, 8,552줄 변경', true],
      ['쉼표 자리수만 다르다', '8552줄', true],
      ['업무 회고에 없는 숫자가 하나라도 있다', 'PR 28건 · 파일 255개', false],
      ['숫자가 없다', 'Router 도입', false],
      ['숫자는 같아도 단위가 다르다', '28개 화면', false],
    ])('isCoveredByWorklog — %s → %s', (_label, item, expected) => {
      expect(isCoveredByWorklog(item, ['PR 28건 머지', '8,552줄 추가'])).toBe(
        expected,
      );
    });

    const evaluation = {
      range: 'TODAY',
      sourceAgentRuns: { workReviewerRunId: 10 },
      qualitative: { summary: '요약', blockers: [], wins: [] },
      careerLog: {
        schemaVersion: 1,
        period: '2026-06-17',
        achievements: {
          quantitative: ['PR 28건 머지', '8,552줄', '파일 255개 수정'],
          qualitative: ['Router 도입 완료'],
        },
        technologies: [],
        impact: '',
      },
    };

    const runTask = async (latestWorklogRun: unknown) =>
      new PoEvalAutopilotTask(
        {
          execute: jest.fn().mockResolvedValue({
            result: evaluation,
            modelUsed: 'codex',
            agentRunId: 50,
          }),
        } as never,
        makeHumanizeService(),
        makeAgentRunService([latestWorklogRun]),
      ).run(CTX);

    it('업무 회고에 나간 숫자만 빼고, 업무 회고에 없던 정량 항목과 정성 성과는 남긴다', async () => {
      const out = await runTask(
        worklogRun({
          endedAt: new Date(),
          output: { impact: { quantitative: ['PR 28건', '8,552줄'] } },
        }),
      );

      expect(out.detailText).toContain('*정량 성과*');
      expect(out.detailText).toContain('파일 255개 수정');
      expect(out.detailText).not.toContain('PR 28건 머지');
      expect(out.detailText).toContain(
        '정량 성과 2건은 업무 회고(run #10) 「정량 근거」와 같은 숫자라',
      );
      expect(out.detailText).toContain('*정성 성과*');
    });

    it('30분 안의 수동 /worklog 가 최신이면 정량 성과를 하나도 빼지 않는다', async () => {
      const out = await runTask(
        worklogRun({
          endedAt: new Date(),
          triggerType: TriggerType.SLACK_COMMAND_WORKLOG,
          output: { impact: { quantitative: ['PR 28건', '8,552줄'] } },
        }),
      );

      expect(out.detailText).toContain('PR 28건 머지');
      expect(out.detailText).toContain('8,552줄');
      expect(out.detailText).not.toContain('생략합니다');
    });
  });
});
