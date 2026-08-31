import {
  careerGroupRepo,
  EveningCareerPayload,
  readImpactContext,
  resolveCareerPrGroups,
} from '../../agent/career-mate/domain/evening-career-payload';

// 저녁 경력 반영 카드 위의 "작업 맥락" 입력칸.
//
// 이력서에 쓸 성과의 재료는 GitHub PR 하나뿐이라, "이 작업이 사용자·매출·비용·처리량에
// 무엇을 했는지" 가 들어갈 자리가 없다. 그 정보는 코드에 없고 사람 기억에만 있는데,
// 기억은 몇 달이면 흐려진다. 그래서 머지 당일 저녁 카드에서 한 줄로 받는다.
//
// 모달(views.open)이 아니라 카드 위 입력칸인 이유는 CTO 분배 카드의 배정 드롭다운과 같다 —
// 사용자가 적은 값이 곧 결과라 LLM 재분류가 필요 없고, 승인 전에 같은 카드의 payload 만
// 갱신하면 되므로 새 preview 도 view_submission 배선도 필요 없다.
//
// 묶음(저장소)마다 칸을 따로 둔다. 묶음 하나가 성과 1건이라 칸 하나로 받으면 회사 저장소의
// 수치가 개인 프로젝트 성과에도 실린다.
//
// 입력은 강제하지 않는다. 비워 두면 payload 에 키가 생기지 않아 도입 전과 완전히 같다.

export const CAREER_CONTEXT_ACTION_IDS = {
  SET: 'career-context:set',
} as const;

const BLOCK_ID_PREFIX = 'career-context';

// Slack plain_text_input 의 max_length. 이력서 한 줄의 근거로 쓸 값이라 문단이 아니라
// 한 줄을 받는다 — 길이를 열어두면 회고 프롬프트에서 diff 보다 맥락이 길어진다.
export const CAREER_CONTEXT_MAX_LENGTH = 300;

export type SlackBlock = Record<string, unknown>;

// 승인 전 카드에만 붙인다. 묶음이 없으면(형태가 다른 payload) 아무것도 그리지 않는다 —
// 승인 버튼까지 막지는 않는다.
export const buildCareerContextInputBlocks = ({
  previewId,
  payload,
}: {
  previewId: string;
  payload: unknown;
}): SlackBlock[] => {
  const candidate =
    typeof payload === 'object' && payload !== null
      ? (payload as EveningCareerPayload)
      : null;
  return resolveCareerPrGroups(candidate).map((refs, index) =>
    buildInputBlock({
      previewId,
      index,
      repo: careerGroupRepo(refs),
      impactContext: readImpactContext(candidate, index),
    }),
  );
};

const buildInputBlock = ({
  previewId,
  index,
  repo,
  impactContext,
}: {
  previewId: string;
  index: number;
  repo: string;
  impactContext: string | undefined;
}): SlackBlock => ({
  type: 'input',
  // 입력 element 는 자체 value 로 대상을 실어 보낼 수 없어(타이핑한 문자열이 value 다)
  // block_id 에 previewId 와 묶음 index 를 싣는다 — 분배 드롭다운과 같은 방식.
  block_id: `${BLOCK_ID_PREFIX}:${previewId}:${index}`,
  // 메시지 안의 input 은 제출 버튼이 없다. 이 값이 없으면 적어도 전달되지 않는다.
  dispatch_action: true,
  label: {
    type: 'plain_text',
    text: `${repo} — 이 작업이 무엇에 영향을 갔나요? (선택)`,
  },
  element: {
    type: 'plain_text_input',
    action_id: CAREER_CONTEXT_ACTION_IDS.SET,
    max_length: CAREER_CONTEXT_MAX_LENGTH,
    // 메시지의 input 값은 서버에 남지 않는다. 이 값이 없으면 슬랙을 다시 열었을 때
    // 저장된 맥락이 사라진 것처럼 보인다.
    ...(impactContext ? { initial_value: impactContext } : {}),
    placeholder: {
      type: 'plain_text',
      text: '예: 결제 실패율 3%→0.5%, 월 2,000건 수동 재시도 제거',
    },
    dispatch_action_config: { trigger_actions_on: ['on_enter_pressed'] },
  },
  hint: {
    type: 'plain_text',
    // "칸마다" 를 명시한다 — 저장되면 카드를 다시 그리므로, 여러 칸을 채운 뒤 한 번만
    // Enter 를 누르면 아직 저장되지 않은 다른 칸의 입력이 그 순간 지워진다.
    text: '칸마다 적고 Enter 를 누르면 저장됩니다. 비워 두면 지금과 똑같이 동작합니다.',
  },
});

// 입력 이벤트의 block_id 에서 previewId 와 묶음 index 를 복원. 형식이 다르면 null —
// 다른 블록의 이벤트를 잘못 처리하지 않도록.
export const parseCareerContextBlockId = (
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

// 입력칸이 보내온 문자열을 저장 가능한 형태로 정규화한다.
// 길이 상한은 입력칸(max_length)에도 걸려 있지만 여기서 다시 자른다 — 그 값은 클라이언트가
// 보내는 payload 일 뿐이고, 이 문자열은 회고 프롬프트와 저장되는 프로필로 그대로 들어간다.
// 긴 붙여넣기 하나가 diff 예산을 밀어낼 수 있다.
export const normalizeImpactContext = (typed: string): string =>
  typed.trim().slice(0, CAREER_CONTEXT_MAX_LENGTH);
