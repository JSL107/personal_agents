import { CtoBeChainPayload } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  applyWorkerChange,
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
