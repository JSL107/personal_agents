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

// 인용 블록 — 판정 대상 문장을 댓글 머리에 싣는다. 누른 뒤 다시 그릴 때 서버에는 그 문장이
// 없으므로(버튼 값에 본문을 싣지 않는다), 핸들러가 원래 메시지에서 이 block_id 의 텍스트를
// 그대로 되읽어 넘긴다. 그래서 인용은 이미 만들어진 mrkdwn 으로 오간다 — 평문으로 되받아
// 다시 이스케이프하면 `&amp;` 가 `&amp;amp;` 로 불어난다.
export const RUN_VERDICT_QUOTE_BLOCK_ID = 'run-verdict-quote';
// 스레드 댓글 머리라 두세 줄 안에서 끝나야 한다. 넘으면 자르고 말줄임을 붙인다.
const RUN_VERDICT_QUOTE_MAX_CHARS = 200;

export const formatRunVerdictQuote = (
  quote: string | undefined,
): string | undefined => {
  const trimmed = quote?.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return undefined;
  }
  const clipped =
    trimmed.length > RUN_VERDICT_QUOTE_MAX_CHARS
      ? `${trimmed.slice(0, RUN_VERDICT_QUOTE_MAX_CHARS)}…`
      : trimmed;
  const escaped = clipped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `*문제 칸*\n> ${escaped}`;
};

// 버튼을 누른 action body 의 원래 판정 댓글에서 인용 블록의 mrkdwn 을 되읽는다. 없거나 모양이
// 다르면 undefined — 인용 없이 다시 그린다(판정 저장은 이미 끝났으니 인용 하나로 갱신을 막지 않는다).
export const readRunVerdictQuote = (body: unknown): string | undefined => {
  const blocks = (body as { message?: { blocks?: unknown } } | null)?.message
    ?.blocks;
  if (!Array.isArray(blocks)) {
    return undefined;
  }
  const found: unknown = blocks.find(
    (block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      (block as { block_id?: unknown }).block_id === RUN_VERDICT_QUOTE_BLOCK_ID,
  );
  const text = (found as { text?: { text?: unknown } } | undefined)?.text?.text;
  return typeof text === 'string' && text.length > 0 ? text : undefined;
};

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
  quoteMrkdwn,
}: {
  agentRunId: number;
  facets: RunVerdictFacet[];
  // `formatRunVerdictQuote` 결과 또는 원래 댓글에서 되읽은 값. 없으면 인용 블록을 내지 않는다.
  quoteMrkdwn?: string;
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
  ...(quoteMrkdwn
    ? [
        {
          type: 'section',
          block_id: RUN_VERDICT_QUOTE_BLOCK_ID,
          text: { type: 'mrkdwn', text: quoteMrkdwn },
        },
      ]
    : []),
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
