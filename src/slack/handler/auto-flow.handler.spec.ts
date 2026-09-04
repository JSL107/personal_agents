import { Assignment } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  buildChainTrail,
  buildCtoFailureRetry,
  buildStepFailureArgs,
  parseStartBeValue,
  parseStartCtoValue,
} from './auto-flow.handler';

const buildAssignment = (
  beAssignment: Assignment['beAssignment'],
  taskId = 't1',
): Assignment => ({
  taskId,
  taskTitle: `task ${taskId}`,
  beAssignment,
  priority: 2,
  reasoning: '',
  confidence: 0.9,
});

describe('buildChainTrail — V3 phase loop chain audit 가시화', () => {
  it('전 step OK — PM → CTO → BE worker 들의 run id 를 → 로 연결', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 99,
      ctoAgentRunId: 100,
      beOutcomes: [
        {
          assignment: buildAssignment(AgentType.BE, 'a1'),
          status: 'OK',
          agentRunId: 101,
          message: 'BE plan #101 생성 완료.',
        },
        {
          assignment: buildAssignment(AgentType.BE_SCHEMA, 'a2'),
          status: 'OK',
          agentRunId: 102,
          message: 'BE_SCHEMA #102 생성 완료.',
        },
      ],
    });

    expect(trail).toBe('PM #99 → CTO #100 → BE #101 → BE_SCHEMA #102');
  });

  it('SKIPPED step 은 (SKIPPED) 라벨 + agentRunId 미존재 시 #—', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 1,
      ctoAgentRunId: 2,
      beOutcomes: [
        {
          assignment: buildAssignment(AgentType.BE_TEST, 'a1'),
          status: 'SKIPPED',
          message: 'BE_TEST filePath 미식별 — SKIPPED.',
        },
      ],
    });

    expect(trail).toBe('PM #1 → CTO #2 → BE_TEST #— (SKIPPED)');
  });

  it('FAILED step 도 (FAILED) 라벨 + agentRunId 가 있으면 #N 보존', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 1,
      ctoAgentRunId: 2,
      beOutcomes: [
        {
          assignment: buildAssignment(AgentType.BE, 'a1'),
          status: 'FAILED',
          agentRunId: 50,
          message: 'BE 실패 — codex capacity',
        },
      ],
    });

    expect(trail).toBe('PM #1 → CTO #2 → BE #50 (FAILED)');
  });

  it('beOutcomes 가 비어 있어도 PM + CTO 만 출력', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 7,
      ctoAgentRunId: 8,
      beOutcomes: [],
    });

    expect(trail).toBe('PM #7 → CTO #8');
  });
});

describe('parseStartCtoValue / parseStartBeValue — attempt 왕복', () => {
  it('attempt 가 실린 value 는 그대로 보존한다', () => {
    const parsed = parseStartCtoValue(
      JSON.stringify({ pmAgentRunId: 9, attempt: 1 }),
    );

    expect(parsed).toEqual({ pmAgentRunId: 9, attempt: 1 });
  });

  // BE 쪽이 양의 attempt 를 흘리면 매 실패가 0 으로 돌아가 상한에 영영 닿지 않는다.
  it('BE value 도 양의 attempt 를 보존한다 — 상한이 무력화되지 않게', () => {
    const parsed = parseStartBeValue(
      JSON.stringify({ pmAgentRunId: 9, ctoAgentRunId: 10, attempt: 2 }),
    );

    expect(parsed).toEqual({ pmAgentRunId: 9, ctoAgentRunId: 10, attempt: 2 });
  });

  it('재시도 도입 전 발행된 버튼(attempt 부재)은 0 으로 수렴한다', () => {
    expect(parseStartCtoValue(JSON.stringify({ pmAgentRunId: 9 }))).toEqual({
      pmAgentRunId: 9,
      attempt: 0,
    });
    expect(
      parseStartBeValue(JSON.stringify({ pmAgentRunId: 9, ctoAgentRunId: 10 })),
    ).toEqual({ pmAgentRunId: 9, ctoAgentRunId: 10, attempt: 0 });
  });

  it('attempt 가 정수가 아니거나 음수면 0 으로 수렴한다', () => {
    expect(
      parseStartBeValue(
        JSON.stringify({ pmAgentRunId: 1, ctoAgentRunId: 2, attempt: -3 }),
      ),
    ).toEqual({ pmAgentRunId: 1, ctoAgentRunId: 2, attempt: 0 });
    expect(
      parseStartCtoValue(JSON.stringify({ pmAgentRunId: 1, attempt: 'x' })),
    ).toEqual({ pmAgentRunId: 1, attempt: 0 });
  });

  it('필수 run id 가 없으면 null (기존 동작 유지)', () => {
    expect(parseStartCtoValue(JSON.stringify({ attempt: 1 }))).toBeNull();
    expect(parseStartBeValue(JSON.stringify({ pmAgentRunId: 1 }))).toBeNull();
    expect(parseStartCtoValue('not-json')).toBeNull();
  });
});

describe('buildStepFailureArgs — step 실패 복귀 엣지', () => {
  const findButton = (
    args: ReturnType<typeof buildStepFailureArgs>,
    actionId: string,
  ): Record<string, unknown> | undefined => {
    const actions = args.blocks?.find((block) => block.type === 'actions');
    const elements = (actions?.elements ?? []) as Record<string, unknown>[];
    return elements.find((element) => element.action_id === actionId);
  };

  it('상한 미만이면 같은 step 재시도 버튼 + 취소 버튼을 붙인다', () => {
    const nextValueJson = JSON.stringify({ pmAgentRunId: 9, attempt: 1 });
    const args = buildStepFailureArgs({
      step: 'CTO',
      message: '쿼터 소진',
      retry: {
        actionId: 'auto-flow:start-cto',
        attempt: 0,
        nextValueJson,
        label: '🔁 CTO 다시 시도',
        guidance: 'PM plan 은 보존되어 있습니다.',
      },
    });

    const retryButton = findButton(args, 'auto-flow:start-cto');
    expect(retryButton).toBeDefined();
    expect(retryButton?.value).toBe(nextValueJson);
    expect(findButton(args, 'auto-flow:cancel')).toBeDefined();
    expect(args.text).toContain('CTO step 실패');
  });

  it('상한(2회) 도달 시 버튼을 생략하고 /auto-flow 재시작을 안내한다', () => {
    const args = buildStepFailureArgs({
      step: 'BE',
      message: '쿼터 소진',
      retry: {
        actionId: 'auto-flow:start-be',
        attempt: 2,
        nextValueJson: JSON.stringify({
          pmAgentRunId: 1,
          ctoAgentRunId: 2,
          attempt: 3,
        }),
        label: '🔁 BE chain 다시 시도',
        guidance: 'CTO 분배는 보존되어 있습니다.',
      },
    });

    expect(args.blocks).toBeUndefined();
    expect(args.text).toContain('재시도 상한');
    expect(args.text).toContain('/auto-flow');
  });

  it('retry 미전달(PM step)이면 기존 text-only 응답 그대로', () => {
    const args = buildStepFailureArgs({ step: 'PM', message: '실패' });

    expect(args.blocks).toBeUndefined();
    expect(args.text).toBe('auto-flow PM step 실패: 실패');
  });

  // Slack section text 상한 3,000자 — 넘기면 응답 자체가 거부돼 재시도 UI 가 안 뜬다.
  it('긴 에러 메시지를 잘라 section block 상한 안에 들어간다', () => {
    const args = buildStepFailureArgs({
      step: 'CTO',
      message: 'x'.repeat(5_000),
      retry: {
        actionId: 'auto-flow:start-cto',
        attempt: 0,
        nextValueJson: JSON.stringify({ pmAgentRunId: 9, attempt: 1 }),
        label: '🔁 CTO 다시 시도',
        guidance: 'PM plan 은 보존되어 있습니다.',
      },
    });

    const section = args.blocks?.find((block) => block.type === 'section');
    const sectionText = (section?.text as { text: string }).text;
    expect(sectionText.length).toBeLessThan(3_000);
    expect(sectionText).toContain('이하 생략');
    expect(args.text.length).toBeLessThan(3_000);
  });
});

describe('buildCtoFailureRetry — worker 성공 후 실패는 재실행하지 않는다', () => {
  const value = { pmAgentRunId: 9, attempt: 0 };

  it('worker 실행 자체가 실패했으면 CTO 재시도 버튼', () => {
    const retry = buildCtoFailureRetry({ value });

    expect(retry.actionId).toBe('auto-flow:start-cto');
    expect(JSON.parse(retry.nextValueJson)).toEqual({
      pmAgentRunId: 9,
      attempt: 1,
    });
  });

  // 윤문·Slack 응답 단계에서 실패한 경우. CTO 를 다시 돌리면 원장에 이미 남은 분배가
  // 중복 생성되고 쿼터도 더 든다.
  it('worker 가 이미 성공했으면 BE 진행 버튼으로 바꾸고 그 run id 를 싣는다', () => {
    const retry = buildCtoFailureRetry({
      value,
      succeededCtoAgentRunId: 123,
    });

    expect(retry.actionId).toBe('auto-flow:start-be');
    expect(JSON.parse(retry.nextValueJson)).toEqual({
      pmAgentRunId: 9,
      ctoAgentRunId: 123,
      attempt: 0,
    });
    expect(retry.guidance).toContain('#123');
  });

  it('CTO 재시도 예산을 이미 쓴 상태여도 worker 성공 시 BE 버튼은 막히지 않는다', () => {
    const retry = buildCtoFailureRetry({
      value: { pmAgentRunId: 9, attempt: 2 },
      succeededCtoAgentRunId: 123,
    });
    const args = buildStepFailureArgs({
      step: 'CTO',
      message: '표시 단계 실패',
      retry,
    });

    expect(args.blocks).toBeDefined();
  });
});
