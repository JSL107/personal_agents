import {
  Assignment,
  AssignmentOutput,
  BeAssignmentType,
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

// Slack 은 메시지당 블록 50개까지 받는다. 머리말·보류·버튼·푸터로 4개를 쓰므로
// 항목은 넉넉히 남는 선에서 끊고, 넘친 만큼은 안내로 알린다 (조용히 잘라내면
// 사용자는 카드에 없는 분배가 실행되는 걸 모른다).
const MAX_CARD_ASSIGNMENTS = 20;

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
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*⚠️ 자동 분배 보류*',
          ...output.unassignedTasks.map(
            (unassigned) =>
              `• ${escapeSlackMrkdwn(unassigned.taskTitle)} — ${escapeSlackMrkdwn(unassigned.reason)}`,
          ),
          '_보류 건은 실행되지 않습니다. 배정하려면 말로 알려주세요 — 예: "테스트 보강은 BE_TEST 로"._',
        ].join('\n'),
      },
    });
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
  const lines = ['*📋 CTO 분배 결과*'];
  if (output.ctoSummary.trim().length > 0) {
    lines.push('');
    lines.push(escapeSlackMrkdwn(output.ctoSummary));
  }
  if (output.assignments.length === 0) {
    lines.push('');
    lines.push('_분배된 task 없음 — 모두 보류로 분류됐습니다._');
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

// 드롭다운 변경 이벤트의 block_id 에서 previewId 와 항목 index 를 복원.
// 형식이 다르면 null — 다른 블록의 이벤트를 잘못 처리하지 않도록.
export const parseAssignmentBlockId = (
  blockId: string | null,
): { previewId: string; index: number } | null => {
  if (blockId === null) {
    return null;
  }
  const segments = blockId.split(':');
  if (segments.length !== 3 || segments[0] !== BLOCK_ID_PREFIX) {
    return null;
  }
  const previewId = segments[1];
  const index = Number.parseInt(segments[2], 10);
  if (previewId.length === 0 || !Number.isInteger(index) || index < 0) {
    return null;
  }
  return { previewId, index };
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
