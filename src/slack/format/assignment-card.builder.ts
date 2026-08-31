import {
  Assignment,
  AssignmentOutput,
  BeAssignmentType,
  UnassignedTask,
} from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';

// CTO 분배 카드 — 배정 변경 드롭다운 + 실행/취소 버튼.
//
// 재배정을 드롭다운으로 두는 이유: 문장으로 받으면 LLM 을 한 번 더 태워야 하고 (느리고,
// "3번" 이 어느 항목인지 오해할 여지가 있다), 드롭다운은 사용자가 고른 값이 곧 결과라
// 재호출도 오해도 없다. 문장 재배정 경로는 그대로 살려둔다 — 우선순위 조정이나 보류로
// 빼기처럼 드롭다운으로 표현되지 않는 요청이 있기 때문.

// worker 선택 드롭다운의 action_id. block_id 에 previewId 와 항목 index 를 실어 보낸다
// (static_select 는 button 과 달리 element 자체 value 를 갖지 못한다).
export const ASSIGNMENT_ACTION_IDS = {
  SET_WORKER: 'assignment:set-worker',
} as const;

const BLOCK_ID_PREFIX = 'assignment-worker';
// 보류 항목의 드롭다운. 배정 항목과 같은 action_id 를 쓰고 block_id 로만 구분한다 —
// 고르는 값(worker 3종)이 같으므로 액션을 나누면 같은 파싱을 두 벌 갖게 된다.
const PENDING_BLOCK_ID_PREFIX = 'assignment-pending';

// Slack 은 메시지당 블록 50개까지 받는다. 머리말·보류·버튼·푸터로 4개를 쓰므로
// 항목은 넉넉히 남는 선에서 끊고, 넘친 만큼은 안내로 알린다 (조용히 잘라내면
// 사용자는 카드에 없는 분배가 실행되는 걸 모른다).
const MAX_CARD_ASSIGNMENTS = 20;
// 보류는 실행 대상이 아니라 결정 대기 목록이다. 배정분과 합쳐 50 블록을 넘기지 않도록
// 더 짧게 끊고, 넘친 건수는 안내로 밝힌다.
const MAX_CARD_UNASSIGNED = 10;

const WORKER_LABEL: Record<BeAssignmentType, string> = {
  [AgentType.BE]: 'BE — 구현',
  [AgentType.BE_SCHEMA]: 'BE_SCHEMA — 스키마',
  [AgentType.BE_TEST]: 'BE_TEST — 테스트',
};

const WORKER_ORDER: BeAssignmentType[] = [
  AgentType.BE,
  AgentType.BE_SCHEMA,
  AgentType.BE_TEST,
];

// confidence 가 이 값 미만이면 ⚠️ — assignment.formatter 와 같은 기준.
const LOW_CONFIDENCE_THRESHOLD = 0.6;

export type SlackBlock = Record<string, unknown>;

export const buildAssignmentCardBlocks = ({
  output,
  previewId,
}: {
  output: AssignmentOutput;
  previewId: string;
}): SlackBlock[] => {
  const shown = output.assignments.slice(0, MAX_CARD_ASSIGNMENTS);
  const hiddenCount = output.assignments.length - shown.length;

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildHeaderText(output),
      },
    },
    ...shown.map((assignment, index) =>
      buildAssignmentBlock({ assignment, index, previewId }),
    ),
  ];

  if (hiddenCount > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_카드에는 ${MAX_CARD_ASSIGNMENTS}건만 표시했습니다. 나머지 ${hiddenCount}건도 실행 대상에 포함됩니다._`,
        },
      ],
    });
  }

  if (output.unassignedTasks.length > 0) {
    const shownUnassigned = output.unassignedTasks.slice(
      0,
      MAX_CARD_UNASSIGNED,
    );
    const hiddenUnassignedCount =
      output.unassignedTasks.length - shownUnassigned.length;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        // 예전에는 "보류하려면 말로 알려주세요" 만 있어서, 카드를 보는 사람이 담당을
        // 정하려면 카드를 떠나 문장을 써야 했다. 드롭다운이 있으면 그 자리에서 끝난다.
        text: '*⚠️ 보류 — 담당을 정해주세요*\n_담당을 고르면 실행 목록으로 옮겨집니다. 실행하지 않을 항목은 그대로 두세요._',
      },
    });
    blocks.push(
      ...shownUnassigned.map((unassigned, index) =>
        buildUnassignedBlock({ unassigned, index, previewId }),
      ),
    );
    if (hiddenUnassignedCount > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_보류 ${hiddenUnassignedCount}건은 카드에 표시하지 않았습니다. 담당을 정하려면 말로 알려주세요._`,
          },
        ],
      });
    }
  }

  blocks.push({
    type: 'actions',
    block_id: `assignment-actions:${previewId}`,
    elements: [
      {
        type: 'button',
        action_id: PREVIEW_ACTION_IDS.APPLY,
        text: { type: 'plain_text', text: '🚀 실행' },
        value: previewId,
        style: 'primary',
      },
      {
        type: 'button',
        action_id: PREVIEW_ACTION_IDS.CANCEL,
        text: { type: 'plain_text', text: '❌ 취소' },
        value: previewId,
        style: 'danger',
      },
    ],
  });

  return blocks;
};

const buildHeaderText = (output: AssignmentOutput): string => {
  // 배정 0건은 제목에서 한 번만 말한다 — 제목과 본문이 같은 사실을 두 번 말하면
  // 정보량 한 줄짜리 카드가 문단 여러 개로 불어난다 (assignment.formatter 와 같은 기준).
  const lines = [
    output.assignments.length > 0
      ? '*📋 CTO 분배 결과*'
      : '*📋 CTO 분배 결과 — 자동 배정 0건*',
  ];
  if (output.ctoSummary.trim().length > 0) {
    lines.push('');
    lines.push(escapeSlackMrkdwn(output.ctoSummary));
  }
  return lines.join('\n');
};

const buildAssignmentBlock = ({
  assignment,
  index,
  previewId,
}: {
  assignment: Assignment;
  index: number;
  previewId: string;
}): SlackBlock => ({
  type: 'section',
  // previewId + index 를 block_id 로 실어 드롭다운 변경 이벤트에서 대상을 특정한다.
  block_id: `${BLOCK_ID_PREFIX}:${previewId}:${index}`,
  text: {
    type: 'mrkdwn',
    text: buildAssignmentText(assignment, index),
  },
  accessory: {
    type: 'static_select',
    action_id: ASSIGNMENT_ACTION_IDS.SET_WORKER,
    options: WORKER_ORDER.map(toWorkerOption),
    initial_option: toWorkerOption(assignment.beAssignment),
  },
});

const buildUnassignedBlock = ({
  unassigned,
  index,
  previewId,
}: {
  unassigned: UnassignedTask;
  index: number;
  previewId: string;
}): SlackBlock => ({
  type: 'section',
  block_id: `${PENDING_BLOCK_ID_PREFIX}:${previewId}:${index}`,
  text: {
    type: 'mrkdwn',
    text: `*${escapeSlackMrkdwn(unassigned.taskTitle)}*\n_${escapeSlackMrkdwn(unassigned.reason)}_`,
  },
  accessory: {
    type: 'static_select',
    action_id: ASSIGNMENT_ACTION_IDS.SET_WORKER,
    // initial_option 을 두지 않는다 — 아직 아무 담당도 정해지지 않은 항목이라
    // 기본값을 찍어두면 사용자가 고르지 않은 배정이 선택된 것처럼 보인다.
    placeholder: { type: 'plain_text', text: '담당 고르기' },
    options: WORKER_ORDER.map(toWorkerOption),
  },
});

const buildAssignmentText = (assignment: Assignment, index: number): string => {
  const lines = [
    `*${index + 1}. ${escapeSlackMrkdwn(assignment.taskTitle)}*`,
    `_${escapeSlackMrkdwn(assignment.reasoning)}_ (confidence ${assignment.confidence.toFixed(2)}${
      assignment.confidence < LOW_CONFIDENCE_THRESHOLD ? ' ⚠️ 낮음' : ''
    })`,
  ];
  // BE_TEST 는 대상 파일이 없으면 실행 단계에서 건너뛴다. 실행을 누르기 전에 알려야
  // 사용자가 "왜 이것만 안 됐지" 를 나중에 되짚지 않는다.
  if (
    assignment.beAssignment === AgentType.BE_TEST &&
    assignment.targetFilePath === undefined
  ) {
    lines.push(
      '⚠️ 대상 파일 경로가 없어 실행 시 건너뜁니다 — 경로를 알려주세요.',
    );
  }
  if (
    assignment.beAssignment === AgentType.BE_TEST &&
    assignment.targetFilePath !== undefined
  ) {
    lines.push(`📄 \`${escapeSlackMrkdwn(assignment.targetFilePath)}\``);
  }
  return lines.join('\n');
};

const toWorkerOption = (worker: BeAssignmentType): SlackBlock => ({
  text: { type: 'plain_text', text: WORKER_LABEL[worker] },
  value: worker,
});

// 드롭다운이 배정 항목의 것인지 보류 항목의 것인지. 같은 action_id 를 쓰므로
// 처리 분기는 block_id 로만 갈린다 (배정은 교체, 보류는 실행 목록으로 승격).
export type AssignmentBlockKind = 'ASSIGNED' | 'PENDING';

export interface AssignmentBlockTarget {
  previewId: string;
  index: number;
  kind: AssignmentBlockKind;
}

// 드롭다운 변경 이벤트의 block_id 에서 previewId 와 항목 index 를 복원.
// 형식이 다르면 null — 다른 블록의 이벤트를 잘못 처리하지 않도록.
export const parseAssignmentBlockId = (
  blockId: string | null,
): AssignmentBlockTarget | null => {
  if (blockId === null) {
    return null;
  }
  const segments = blockId.split(':');
  if (segments.length !== 3) {
    return null;
  }
  const kind = toBlockKind(segments[0]);
  if (kind === null) {
    return null;
  }
  const previewId = segments[1];
  const index = Number.parseInt(segments[2], 10);
  if (previewId.length === 0 || !Number.isInteger(index) || index < 0) {
    return null;
  }
  return { previewId, index, kind };
};

const toBlockKind = (prefix: string): AssignmentBlockKind | null => {
  if (prefix === BLOCK_ID_PREFIX) {
    return 'ASSIGNED';
  }
  if (prefix === PENDING_BLOCK_ID_PREFIX) {
    return 'PENDING';
  }
  return null;
};

// 드롭다운에서 고른 worker. BE 계열 3종이 아니면 null (payload 오염 차단).
export const parseSelectedWorker = (
  value: string | null,
): BeAssignmentType | null => {
  if (
    value === AgentType.BE ||
    value === AgentType.BE_SCHEMA ||
    value === AgentType.BE_TEST
  ) {
    return value;
  }
  return null;
};

const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
