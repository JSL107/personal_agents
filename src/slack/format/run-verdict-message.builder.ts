import {
  getRunVerdictLabel,
  isAllowedRunVerdict,
  isRunVerdictFacet,
  RUN_VERDICT_FACETS,
  RunVerdictFacet,
} from '../../agent-run/domain/run-verdict';

// 버튼마다 action_id 가 다르다(한 actions 블록 안에서 action_id 는 겹칠 수 없다). 핸들러는
// 이 접두사로 한 번에 받는다.
export const RUN_VERDICT_ACTION_PREFIX = 'run_verdict:';
export const RUN_VERDICT_ACTION_PATTERN = /^run_verdict:/;

export const RUN_VERDICT_FALLBACK_TEXT =
  '🌙 저녁 회고 판정 — 누른 것만 판정으로 셉니다.';

// 버튼 값 — 슬랙이 그대로 되돌려 주는 입력이다. 사람 이름·본문은 싣지 않는다(설계 §3 공통 규칙).
// `facets` 는 이 댓글에 나간 축 목록이다. 누른 뒤 댓글을 다시 그릴 때 "문제 칸이 비어 축 ① 을
// 내지 않은 날" 을 되살리지 않으려면 처음 낸 축을 알아야 하는데, 서버에는 그 기록이 없다.
interface RunVerdictButtonValue {
  agentRunId: number;
  facet: RunVerdictFacet;
  verdict: string;
  facets: RunVerdictFacet[];
}

export type RunVerdictSelection = RunVerdictButtonValue;

export const buildRunVerdictBlocks = ({
  agentRunId,
  facets,
  verdicts,
}: {
  agentRunId: number;
  facets: RunVerdictFacet[];
  // 이미 내린 판정(축 → 사람별 값). 없으면 "판정 전". 댓글은 채널에 하나라 누른 사람 모두를 적는다.
  verdicts: Partial<
    Record<RunVerdictFacet, { slackUserId: string; verdict: string }[]>
  >;
}): Array<Record<string, unknown>> => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '🌙 *저녁 회고 판정* — 누른 것만 판정으로 셉니다.',
    },
  },
  ...facets.flatMap((facet) => {
    const definition = RUN_VERDICT_FACETS[facet];
    const chosen = verdicts[facet] ?? [];
    const status =
      chosen.length > 0
        ? `판정됨: ${chosen
            .map(
              ({ slackUserId, verdict }) =>
                `${getRunVerdictLabel(facet, verdict)} <@${slackUserId}>`,
            )
            .join(' · ')} (바꾸려면 다시 누르기)`
        : '판정 전';
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${definition.label}* — ${status}` },
      },
      {
        type: 'actions',
        block_id: `run-verdict:${agentRunId}:${facet}`,
        elements: Object.entries(definition.verdicts).map(
          ([verdict, label]) => ({
            type: 'button',
            action_id: `${RUN_VERDICT_ACTION_PREFIX}${facet}:${verdict}`,
            text: { type: 'plain_text', text: label },
            value: JSON.stringify({ agentRunId, facet, verdict, facets }),
          }),
        ),
      },
    ];
  }),
];

// 허용 목록 밖이면 null — 저장하지 않는다. 버튼 값은 클라이언트에서 온 입력이다.
export const parseRunVerdictValue = (
  raw: string | null,
): RunVerdictSelection | null => {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const { agentRunId, facet, verdict, facets } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof agentRunId !== 'number' ||
    !Number.isSafeInteger(agentRunId) ||
    agentRunId <= 0 ||
    !isRunVerdictFacet(facet) ||
    !isAllowedRunVerdict(facet, verdict) ||
    !Array.isArray(facets) ||
    !facets.every(isRunVerdictFacet) ||
    !facets.includes(facet)
  ) {
    return null;
  }
  return { agentRunId, facet, verdict, facets: [...new Set(facets)] };
};
