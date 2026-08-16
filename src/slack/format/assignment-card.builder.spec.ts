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

  it('보류 목록이 있으면 실행되지 않는다고 함께 알린다', () => {
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
    expect(text).toContain('실행되지 않습니다');
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
    });
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
