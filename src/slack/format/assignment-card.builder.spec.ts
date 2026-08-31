import { Assignment, AssignmentOutput } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';
import {
  ASSIGNMENT_ACTION_IDS,
  buildAssignmentCardBlocks,
  parseAssignmentBlockId,
  parseSelectedWorker,
} from './assignment-card.builder';

const assignment = (
  beAssignment: Assignment['beAssignment'],
  overrides: Partial<Assignment> = {},
): Assignment => ({
  taskId: overrides.taskId ?? 't:1',
  taskTitle: overrides.taskTitle ?? 'Router 마무리',
  beAssignment,
  priority: overrides.priority ?? 1,
  reasoning: overrides.reasoning ?? 'BE 진입 worker',
  confidence: overrides.confidence ?? 0.9,
  ...(overrides.targetFilePath !== undefined
    ? { targetFilePath: overrides.targetFilePath }
    : {}),
});

const output = (
  overrides: Partial<AssignmentOutput> = {},
): AssignmentOutput => ({
  assignments: overrides.assignments ?? [assignment(AgentType.BE)],
  unassignedTasks: overrides.unassignedTasks ?? [],
  ctoSummary: overrides.ctoSummary ?? '1건 분배',
});

const findBlocks = (
  blocks: Array<Record<string, unknown>>,
  type: string,
): Array<Record<string, unknown>> =>
  blocks.filter((block) => block.type === type);

describe('buildAssignmentCardBlocks', () => {
  it('항목마다 worker 선택 드롭다운을 단다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({
        assignments: [
          assignment(AgentType.BE, { taskId: 'a1' }),
          assignment(AgentType.BE_SCHEMA, { taskId: 'a2' }),
        ],
      }),
      previewId: 'p-1',
    });

    const selects = blocks
      .map((block) => block.accessory as Record<string, unknown> | undefined)
      .filter((accessory) => accessory !== undefined);
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select?.type).toBe('static_select');
      expect(select?.action_id).toBe(ASSIGNMENT_ACTION_IDS.SET_WORKER);
      expect(select?.options).toHaveLength(3);
    }
  });

  // 드롭다운이 현재 배정을 안 보여주면 사용자는 무엇을 바꾸는지 모른 채 고르게 된다.
  it('드롭다운 초기값은 현재 배정된 worker', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({ assignments: [assignment(AgentType.BE_SCHEMA)] }),
      previewId: 'p-1',
    });

    const select = blocks.find((block) => block.accessory !== undefined)
      ?.accessory as Record<string, unknown>;
    const initial = select.initial_option as Record<string, unknown>;
    expect(initial.value).toBe(AgentType.BE_SCHEMA);
  });

  // 이벤트에서 대상을 특정하는 유일한 통로 — static_select 는 자체 value 를 못 갖는다.
  it('block_id 에 previewId 와 항목 index 를 실어 보낸다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({
        assignments: [
          assignment(AgentType.BE, { taskId: 'a1' }),
          assignment(AgentType.BE, { taskId: 'a2' }),
        ],
      }),
      previewId: 'p-42',
    });

    const ids = blocks
      .filter((block) => block.accessory !== undefined)
      .map((block) => block.block_id);
    expect(ids).toEqual([
      'assignment-worker:p-42:0',
      'assignment-worker:p-42:1',
    ]);
  });

  it('실행 / 취소 버튼에 previewId 를 담는다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output(),
      previewId: 'p-1',
    });

    const actions = findBlocks(blocks, 'actions')[0];
    const elements = actions.elements as Array<Record<string, unknown>>;
    expect(elements.map((element) => element.action_id)).toEqual([
      PREVIEW_ACTION_IDS.APPLY,
      PREVIEW_ACTION_IDS.CANCEL,
    ]);
    expect(elements.every((element) => element.value === 'p-1')).toBe(true);
  });

  // 실행을 누르기 전에 알려야 "왜 이것만 안 됐지" 를 나중에 되짚지 않는다.
  it('BE_TEST 인데 대상 파일이 없으면 건너뛴다고 카드에 표시', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({ assignments: [assignment(AgentType.BE_TEST)] }),
      previewId: 'p-1',
    });

    const text = JSON.stringify(blocks);
    expect(text).toContain('건너뜁니다');
  });

  it('BE_TEST 에 대상 파일이 있으면 경로를 보여준다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({
        assignments: [
          assignment(AgentType.BE_TEST, {
            targetFilePath: 'src/foo/bar.service.ts',
          }),
        ],
      }),
      previewId: 'p-1',
    });

    const text = JSON.stringify(blocks);
    expect(text).toContain('src/foo/bar.service.ts');
    expect(text).not.toContain('건너뜁니다');
  });

  it('보류 목록이 있으면 항목과 보류 사유를 함께 보여준다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({
        unassignedTasks: [
          { taskId: 't:2', taskTitle: '테스트 보강', reason: '경계 모호' },
        ],
      }),
      previewId: 'p-1',
    });

    const text = JSON.stringify(blocks);
    expect(text).toContain('테스트 보강');
    expect(text).toContain('경계 모호');
    expect(text).toContain('담당을 정해주세요');
  });

  // 보류를 배정하는 유일한 입구가 자연어였을 때는, 카드를 보는 사람이 담당을 정하려면
  // 카드를 떠나 문장을 써야 했고 LLM 이 어느 항목인지 다시 맞혀야 했다.
  it('보류 항목마다 담당 드롭다운을 붙인다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({
        assignments: [],
        unassignedTasks: [
          { taskId: 't:2', taskTitle: '테스트 보강', reason: '경계 모호' },
        ],
      }),
      previewId: 'p-1',
    });

    const pendingBlock = blocks.find(
      (block) => block.block_id === 'assignment-pending:p-1:0:t:2',
    );
    expect(pendingBlock).toBeDefined();
    const accessory = pendingBlock?.accessory as Record<string, unknown>;
    expect(accessory.type).toBe('static_select');
    // 아직 아무 담당도 정해지지 않은 항목이라 기본값을 찍어두면 사용자가 고르지 않은
    // 배정이 선택된 것처럼 보인다.
    expect(accessory.initial_option).toBeUndefined();
    expect(accessory.options).toHaveLength(3);
  });

  // 실행할 배정이 없는 카드에서 실행 버튼은 눌러도 아무 일이 없거나 카드만 닫는다 —
  // 그러면 사용자는 담당을 정할 기회를 잃는다.
  it('실행할 배정이 없으면 실행 버튼을 그리지 않는다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output({
        assignments: [],
        unassignedTasks: [
          { taskId: 't:2', taskTitle: '테스트 보강', reason: '경계 모호' },
        ],
      }),
      previewId: 'p-1',
    });

    const actions = blocks.find((block) => block.type === 'actions');
    const elements = actions?.elements as Array<Record<string, unknown>>;
    expect(elements.map((element) => element.action_id)).toEqual([
      'preview:cancel',
    ]);
  });

  it('배정이 있으면 실행 버튼을 그린다', () => {
    const blocks = buildAssignmentCardBlocks({
      output: output(),
      previewId: 'p-1',
    });

    const actions = blocks.find((block) => block.type === 'actions');
    const elements = actions?.elements as Array<Record<string, unknown>>;
    expect(elements.map((element) => element.action_id)).toEqual([
      'preview:apply',
      'preview:cancel',
    ]);
  });

  it('보류가 10건을 넘으면 잘라내되 몇 건이 안 보이는지 알린다', () => {
    const many = Array.from({ length: 13 }, (_unused, index) => ({
      taskId: `u${index}`,
      taskTitle: `보류 ${index}`,
      reason: '경계 모호',
    }));
    const blocks = buildAssignmentCardBlocks({
      output: output({ assignments: [], unassignedTasks: many }),
      previewId: 'p-1',
    });

    const pendingCount = blocks.filter((block) =>
      String(block.block_id ?? '').startsWith('assignment-pending:'),
    ).length;
    expect(pendingCount).toBe(10);
    expect(JSON.stringify(blocks)).toContain('보류 3건');
  });

  // 조용히 잘라내면 사용자는 카드에 없는 분배가 실행되는 걸 모른다.
  it('항목이 20건을 넘으면 잘라내되 몇 건이 안 보이는지 알린다', () => {
    const many = Array.from({ length: 23 }, (_unused, index) =>
      assignment(AgentType.BE, { taskId: `a${index}` }),
    );
    const blocks = buildAssignmentCardBlocks({
      output: output({ assignments: many }),
      previewId: 'p-1',
    });

    const selectCount = blocks.filter(
      (block) => block.accessory !== undefined,
    ).length;
    expect(selectCount).toBe(20);
    expect(JSON.stringify(blocks)).toContain('나머지 3건');
  });

  it('Slack 블록 상한(50)을 넘기지 않는다', () => {
    const many = Array.from({ length: 40 }, (_unused, index) =>
      assignment(AgentType.BE, { taskId: `a${index}` }),
    );
    const blocks = buildAssignmentCardBlocks({
      output: output({
        assignments: many,
        unassignedTasks: [{ taskId: 'u', taskTitle: 'u', reason: 'r' }],
      }),
      previewId: 'p-1',
    });

    expect(blocks.length).toBeLessThanOrEqual(50);
  });
});

describe('parseAssignmentBlockId', () => {
  it('previewId 와 index 를 복원', () => {
    expect(parseAssignmentBlockId('assignment-worker:p-42:3')).toEqual({
      previewId: 'p-42',
      index: 3,
      kind: 'ASSIGNED',
    });
  });

  // 두 드롭다운은 action_id 가 같다 — 처리 분기(교체 vs 승격)가 block_id 하나에만
  // 걸려 있으므로, 종류를 잘못 읽으면 보류 항목이 배정 항목을 덮어쓴다.
  it('보류 항목 block_id 는 PENDING + taskId 로 읽는다', () => {
    expect(parseAssignmentBlockId('assignment-pending:p-42:0:t-9')).toEqual({
      previewId: 'p-42',
      index: 0,
      kind: 'PENDING',
      taskId: 't-9',
    });
  });

  // taskId 는 LLM 이 채우는 값이라 콜론이 들어올 수 있다. 앞 세 조각만 고정으로 읽고
  // 나머지를 다시 이어 붙이지 않으면 대상이 잘려 엉뚱한 항목을 찾게 된다.
  it('taskId 에 콜론이 있어도 원래 값으로 복원한다', () => {
    expect(
      parseAssignmentBlockId('assignment-pending:p-42:0:acme/app#52:extra'),
    ).toEqual({
      previewId: 'p-42',
      index: 0,
      kind: 'PENDING',
      taskId: 'acme/app#52:extra',
    });
  });

  it('보류 block_id 에 taskId 가 없으면 거부한다', () => {
    expect(parseAssignmentBlockId('assignment-pending:p-42:0')).toBeNull();
  });

  // 배정 쪽은 순번만 쓴다 — 꼬리가 붙은 형식은 다른 블록의 이벤트일 수 있다.
  it('배정 block_id 에 꼬리가 붙으면 거부한다', () => {
    expect(parseAssignmentBlockId('assignment-worker:p-42:0:extra')).toBeNull();
  });

  // 다른 블록의 이벤트를 잘못 처리하면 엉뚱한 카드의 배정이 바뀐다.
  it.each([
    ['null', null],
    ['접두사 불일치', 'other:p-1:0'],
    ['조각 수 부족', 'assignment-worker:p-1'],
    ['index 가 숫자 아님', 'assignment-worker:p-1:x'],
    ['index 음수', 'assignment-worker:p-1:-1'],
    ['previewId 빈 값', 'assignment-worker::0'],
  ])('%s 이면 null', (_label, blockId) => {
    expect(parseAssignmentBlockId(blockId)).toBeNull();
  });
});

describe('parseSelectedWorker', () => {
  it.each([AgentType.BE, AgentType.BE_SCHEMA, AgentType.BE_TEST])(
    '%s 는 그대로 통과',
    (worker) => {
      expect(parseSelectedWorker(worker)).toBe(worker);
    },
  );

  // payload 오염 차단 — BE 계열이 아닌 값이 들어오면 실행 단계에서 터진다.
  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['다른 worker', 'PM'],
  ])('%s 은 null', (_label, value) => {
    expect(parseSelectedWorker(value)).toBeNull();
  });
});
