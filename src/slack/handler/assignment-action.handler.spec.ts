import { CtoBeChainPayload } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  applyWorkerChange,
  promoteUnassigned,
  toDisplayOutput,
} from './assignment-action.handler';

const payload = (
  overrides: Partial<CtoBeChainPayload> = {},
): CtoBeChainPayload => ({
  ctoAgentRunId: overrides.ctoAgentRunId ?? 42,
  slackUserId: overrides.slackUserId ?? 'U1',
  assignments: overrides.assignments ?? [
    {
      taskId: 't:1',
      taskTitle: 'Router 마무리',
      beAssignment: AgentType.BE,
      priority: 1,
      reasoning: 'LLM 이 남긴 근거',
      confidence: 0.7,
    },
    {
      taskId: 't:2',
      taskTitle: 'Schema 변경',
      beAssignment: AgentType.BE_SCHEMA,
      priority: 2,
      reasoning: '스키마 신호',
      confidence: 0.8,
    },
  ],
  ...(overrides.ctoSummary !== undefined
    ? { ctoSummary: overrides.ctoSummary }
    : {}),
  ...(overrides.unassignedTasks !== undefined
    ? { unassignedTasks: overrides.unassignedTasks }
    : {}),
});

describe('promoteUnassigned', () => {
  const withPending = () =>
    payload({
      unassignedTasks: [
        { taskId: 't:9', taskTitle: '테스트 보강', reason: '경계 모호' },
        { taskId: 't:10', taskTitle: '문서 검증', reason: '구현 아님' },
      ],
    });

  it('고른 보류 항목을 실행 목록으로 옮기고 보류에서 뺀다', () => {
    const updated = promoteUnassigned({
      payload: withPending(),
      taskId: 't:9',
      worker: AgentType.BE_TEST,
    });

    const promoted = updated.assignments[updated.assignments.length - 1];
    expect(promoted.taskId).toBe('t:9');
    expect(promoted.beAssignment).toBe(AgentType.BE_TEST);
    expect(updated.unassignedTasks).toHaveLength(1);
    expect(updated.unassignedTasks?.[0].taskId).toBe('t:10');
  });

  // 사용자가 직접 고른 값이므로 LLM 의 보류 사유를 근거로 남기면 결과와 설명이 어긋난다.
  it('승격한 항목의 근거는 사용자 지정 + confidence 1 이다', () => {
    const updated = promoteUnassigned({
      payload: withPending(),
      taskId: 't:9',
      worker: AgentType.BE,
    });

    const promoted = updated.assignments[updated.assignments.length - 1];
    expect(promoted.reasoning).toBe('사용자 지정');
    expect(promoted.confidence).toBe(1);
    expect(promoted.priority).toBe(2);
  });

  it('기존 배정은 건드리지 않는다', () => {
    const before = withPending();
    const updated = promoteUnassigned({
      payload: before,
      taskId: 't:10',
      worker: AgentType.BE,
    });

    expect(updated.assignments.slice(0, 2)).toEqual(before.assignments);
  });

  // 오래된 카드의 이벤트가 엉뚱한 항목을 배정하면 사용자가 고르지 않은 일이 실행된다.
  it('카드에 없는 taskId 면 거부한다', () => {
    expect(() =>
      promoteUnassigned({
        payload: withPending(),
        taskId: 't:없음',
        worker: AgentType.BE,
      }),
    ).toThrow('카드에서 찾지 못했습니다');
  });

  it('보류 목록이 아예 없는 옛 카드면 거부한다', () => {
    expect(() =>
      promoteUnassigned({
        payload: payload(),
        taskId: 't:9',
        worker: AgentType.BE,
      }),
    ).toThrow('찾지 못했습니다');
  });

  // 첫 승격으로 보류 목록이 줄어든 뒤, 아직 다시 그려지지 않은 카드에서 도착한 두 번째
  // 이벤트. 순번으로 찾으면 뒤 항목이 한 칸 당겨져 사용자가 고르지 않은 일이 배정된다.
  it('첫 승격 뒤 도착한 옛 카드 이벤트가 다른 항목을 승격하지 않는다', () => {
    const first = promoteUnassigned({
      payload: withPending(),
      taskId: 't:9',
      worker: AgentType.BE,
    });

    // 옛 카드의 두 번째 항목(index 1 = t:10)을 고른 이벤트가 뒤늦게 도착한다.
    // 목록은 이미 [t:10] 한 건으로 줄어, 순번 1 은 존재하지 않는다.
    const second = promoteUnassigned({
      payload: first,
      taskId: 't:10',
      worker: AgentType.BE_TEST,
    });

    expect(second.assignments.map((item) => item.taskId)).toEqual([
      't:1',
      't:2',
      't:9',
      't:10',
    ]);
    expect(second.unassignedTasks).toHaveLength(0);
  });

  // 같은 항목을 두 번 고른 이벤트(중복 전달·연타)는 두 번째가 거절돼야 한다 —
  // 통과하면 같은 task 가 실행 목록에 두 번 들어간다.
  it('이미 승격한 항목을 다시 고르면 거부한다', () => {
    const first = promoteUnassigned({
      payload: withPending(),
      taskId: 't:9',
      worker: AgentType.BE,
    });

    expect(() =>
      promoteUnassigned({
        payload: first,
        taskId: 't:9',
        worker: AgentType.BE_TEST,
      }),
    ).toThrow('찾지 못했습니다');
  });
});

describe('applyWorkerChange', () => {
  it('지정한 항목의 worker 만 바꾼다', () => {
    const updated = applyWorkerChange({
      payload: payload(),
      index: 0,
      worker: AgentType.BE_TEST,
    });

    expect(updated.assignments[0].beAssignment).toBe(AgentType.BE_TEST);
    expect(updated.assignments[1].beAssignment).toBe(AgentType.BE_SCHEMA);
  });

  // 바뀐 배정에 LLM 의 옛 근거가 남으면 설명과 결과가 어긋난다.
  it('바뀐 항목의 근거는 사용자 지정 + confidence 1 로 덮는다', () => {
    const updated = applyWorkerChange({
      payload: payload(),
      index: 0,
      worker: AgentType.BE_TEST,
    });

    expect(updated.assignments[0].reasoning).toBe('사용자 지정');
    expect(updated.assignments[0].confidence).toBe(1);
    // 건드리지 않은 항목의 근거는 그대로.
    expect(updated.assignments[1].reasoning).toBe('스키마 신호');
  });

  it('taskId / 실행 대상 run 등 나머지 필드는 보존', () => {
    const original = payload();
    const updated = applyWorkerChange({
      payload: original,
      index: 1,
      worker: AgentType.BE,
    });

    expect(updated.ctoAgentRunId).toBe(42);
    expect(updated.slackUserId).toBe('U1');
    expect(updated.assignments[1].taskId).toBe('t:2');
    expect(updated.assignments[1].taskTitle).toBe('Schema 변경');
  });

  it('원본 payload 를 변형하지 않는다', () => {
    const original = payload();
    applyWorkerChange({
      payload: original,
      index: 0,
      worker: AgentType.BE_TEST,
    });

    expect(original.assignments[0].beAssignment).toBe(AgentType.BE);
    expect(original.assignments[0].reasoning).toBe('LLM 이 남긴 근거');
  });

  // 오래된 카드의 드롭다운을 눌렀을 때 엉뚱한 항목을 바꾸지 않도록.
  it('범위를 벗어난 index 는 명시 에러', () => {
    expect(() =>
      applyWorkerChange({
        payload: payload(),
        index: 5,
        worker: AgentType.BE,
      }),
    ).toThrow('카드에 없습니다');
  });
});

describe('toDisplayOutput', () => {
  it('payload 의 표시 정보로 카드 재렌더용 output 을 만든다', () => {
    const result = toDisplayOutput(
      payload({
        ctoSummary: '2건 분배',
        unassignedTasks: [{ taskId: 'u', taskTitle: '보류건', reason: '모호' }],
      }),
    );

    expect(result.ctoSummary).toBe('2건 분배');
    expect(result.unassignedTasks).toHaveLength(1);
    expect(result.assignments).toHaveLength(2);
  });

  // 표시 정보가 없는 과거 카드도 렌더는 되어야 한다.
  it('표시 정보가 없으면 빈 값으로 채운다', () => {
    const result = toDisplayOutput(payload());

    expect(result.ctoSummary).toBe('');
    expect(result.unassignedTasks).toEqual([]);
  });
});
