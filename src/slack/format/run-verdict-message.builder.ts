import {
  getRunVerdictHeading,
  getRunVerdictLabel,
  getRunVerdictQuoteLabel,
  isAllowedRunVerdict,
  isRunVerdictFacet,
  RUN_VERDICT_FACETS,
  RunVerdictFacet,
} from '../../agent-run/domain/run-verdict';
import { SlackBlock } from './message-blocks.builder';

// 버튼마다 action_id 가 다르다(한 actions 블록 안에서 action_id 는 겹칠 수 없다). 핸들러는
// 이 접두사로 한 번에 받는다.
export const RUN_VERDICT_ACTION_PREFIX = 'run_verdict:';
export const RUN_VERDICT_ACTION_PATTERN = /^run_verdict:/;

// 알림용 대체 문구. 머리는 댓글의 축이 정한다 — 같은 버튼 틀을 저녁 회고·PO 대행·아침 계획이 같이 쓴다.
export const buildRunVerdictFallbackText = (
  facets: RunVerdictFacet[],
): string => `${getRunVerdictHeading(facets)} — 누른 것만 판정으로 셉니다.`;

// 인용 블록 — 판정 대상 문장을 댓글 머리에 싣는다. 누른 뒤 다시 그릴 때 서버에는 그 문장이
// 없으므로(버튼 값에 본문을 싣지 않는다), 핸들러가 원래 메시지에서 이 block_id 의 텍스트를
// 그대로 되읽어 넘긴다. 그래서 인용은 이미 만들어진 mrkdwn 으로 오간다 — 평문으로 되받아
// 다시 이스케이프하면 `&amp;` 가 `&amp;amp;` 로 불어난다.
export const RUN_VERDICT_QUOTE_BLOCK_ID = 'run-verdict-quote';
// 스레드 댓글 머리라 두세 줄 안에서 끝나야 한다. 넘으면 자르고 말줄임을 붙인다.
const RUN_VERDICT_QUOTE_MAX_CHARS = 200;

// `label` 은 인용 머리 이름(`getRunVerdictQuoteLabel`). 없으면 인용만 싣는다.
export const formatRunVerdictQuote = (
  quote: string | undefined,
  label?: string,
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
  return label ? `*${label}*\n> ${escaped}` : `> ${escaped}`;
};

// 버튼을 누른 action body 의 원래 판정 댓글에서 인용 블록의 mrkdwn 을 되읽는다. 없거나 모양이
// 다르면 undefined — 인용 없이 다시 그린다(판정 저장은 이미 끝났으니 인용 하나로 갱신을 막지 않는다).
export const readRunVerdictQuote = (
  blocks: SlackBlock[] | undefined,
): string | undefined => {
  const found = blocks?.find(
    (block) => block.block_id === RUN_VERDICT_QUOTE_BLOCK_ID,
  );
  const text = (found?.text as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string' || text.length === 0) {
    return undefined;
  }
  return text;
};

// 버튼 값 — 슬랙이 그대로 되돌려 주는 입력이다. 사람 이름·본문은 싣지 않는다(설계 §3 공통 규칙).
// `facets` 는 이 댓글에 나간 축 목록이다. 누른 뒤 댓글을 다시 그릴 때 "아쉬운 점이 비어 축 ① 을
// 내지 않은 날" 을 되살리지 않으려면 처음 낸 축을 알아야 하는데, 서버에는 그 기록이 없다.
interface RunVerdictButtonValue {
  agentRunId: number;
  facet: RunVerdictFacet;
  verdict: string;
  facets: RunVerdictFacet[];
}

export type RunVerdictSelection = RunVerdictButtonValue;

// 한 사람이 한 축에 내린 판정.
export interface RunVerdictChoice {
  slackUserId: string;
  verdict: string;
}

// 실행 하나에 내려진 판정 — 축마다 누른 사람 모두. 메시지는 채널에 하나라 누른 사람을 다 적는다.
export type RunVerdictChoices = ReadonlyMap<
  RunVerdictFacet,
  RunVerdictChoice[]
>;

// 축마다 "물음 + 상태" 줄의 block_id. 누른 뒤 핸들러가 메시지에서 이 줄만 찾아 상태를 다시 쓴다 —
// 한 메시지에 실행이 여럿 실리는 주간 카드도 같은 방식으로 갱신된다.
const RUN_VERDICT_STATUS_BLOCK_ID_PATTERN = /^run-verdict-status:(\d+):(\w+)$/;

export interface RunVerdictStatusTarget {
  agentRunId: number;
  facet: RunVerdictFacet;
}

const toRunVerdictStatusBlockId = ({
  agentRunId,
  facet,
}: RunVerdictStatusTarget): string =>
  `run-verdict-status:${agentRunId}:${facet}`;

interface RunVerdictStatusInput {
  facet: RunVerdictFacet;
  chosen: RunVerdictChoice[];
}

// 판정 전이면 물음만 둔다. "판정 전" 꼬리표는 읽을 거리만 늘렸다.
const formatRunVerdictStatus = ({
  facet,
  chosen,
}: RunVerdictStatusInput): string => {
  const question = `*${RUN_VERDICT_FACETS[facet].question}*`;
  if (chosen.length === 0) {
    return question;
  }
  const picked = chosen
    .map(
      ({ slackUserId, verdict }) =>
        `${getRunVerdictLabel(facet, verdict)} <@${slackUserId}>`,
    )
    .join(' · ');
  return `${question}\n✅ 판정됨: ${picked} _(바꾸려면 다시 누르기)_`;
};

interface RunVerdictFacetBlocksInput extends RunVerdictStatusInput {
  agentRunId: number;
  // 버튼 값에 함께 싣는, 이 메시지에 나간 실행의 축 목록(RunVerdictButtonValue.facets).
  facets: RunVerdictFacet[];
}

const buildRunVerdictFacetBlocks = ({
  agentRunId,
  facet,
  facets,
  chosen,
}: RunVerdictFacetBlocksInput): SlackBlock[] => {
  const buttons = Object.entries(RUN_VERDICT_FACETS[facet].verdicts).map(
    ([verdict, label]) => ({
      type: 'button',
      action_id: `${RUN_VERDICT_ACTION_PREFIX}${facet}:${verdict}`,
      text: { type: 'plain_text', text: label },
      value: JSON.stringify({ agentRunId, facet, verdict, facets }),
    }),
  );
  return [
    {
      type: 'section',
      block_id: toRunVerdictStatusBlockId({ agentRunId, facet }),
      text: { type: 'mrkdwn', text: formatRunVerdictStatus({ facet, chosen }) },
    },
    {
      type: 'actions',
      block_id: `run-verdict:${agentRunId}:${facet}`,
      elements: buttons,
    },
  ];
};

interface RunVerdictBlocksInput {
  agentRunId: number;
  facets: RunVerdictFacet[];
  // `formatRunVerdictQuote` 결과 또는 원래 댓글에서 되읽은 값. 없으면 인용 블록을 내지 않는다.
  quoteMrkdwn?: string;
  // 이미 내린 판정. 댓글은 채널에 하나라 누른 사람 모두를 적는다.
  verdicts: RunVerdictChoices;
}

export const buildRunVerdictBlocks = ({
  agentRunId,
  facets,
  verdicts,
  quoteMrkdwn,
}: RunVerdictBlocksInput): SlackBlock[] => {
  const heading: SlackBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${getRunVerdictHeading(facets)}* — 누른 것만 판정으로 셉니다.`,
    },
  };
  const quote: SlackBlock[] = quoteMrkdwn
    ? [
        {
          type: 'section',
          block_id: RUN_VERDICT_QUOTE_BLOCK_ID,
          text: { type: 'mrkdwn', text: quoteMrkdwn },
        },
      ]
    : [];
  const facetBlocks = facets.flatMap((facet) =>
    buildRunVerdictFacetBlocks({
      agentRunId,
      facet,
      facets,
      chosen: verdicts.get(facet) ?? [],
    }),
  );
  return [heading, ...quote, ...facetBlocks];
};

export interface RunVerdictDigestCardEntry {
  agentRunId: number;
  facets: RunVerdictFacet[];
  // 예: "10/27(화)". 인용은 원문 그대로 받아 여기서 이스케이프한다.
  dateLabel: string;
  quote: string;
}

// 주간 카드 한 통의 블록. 슬랙 메시지 한 통에 싣는 단위다.
export type RunVerdictDigestPage = SlackBlock[];

// 슬랙 메시지 한 통의 블록 상한은 50 이다. 넘으면 발송 자체가 거부되므로 넘치는 실행은 다음 통으로 넘긴다
// — 버리면 그 주의 판정 기회가 조용히 사라진다.
const SLACK_MESSAGE_BLOCK_LIMIT = 50;
// 머리 한 블록.
const DIGEST_HEADER_BLOCK_COUNT = 1;

// 날짜·인용 1 + 축마다 물음·버튼 2
const countEntryBlocks = (entry: RunVerdictDigestCardEntry): number =>
  1 + entry.facets.length * 2;

const countGroupBlocks = (group: RunVerdictDigestCardEntry[]): number =>
  group.reduce(
    (total, entry) => total + countEntryBlocks(entry),
    DIGEST_HEADER_BLOCK_COUNT,
  );

// 앞에서부터 채우고, 다음 실행이 상한을 넘기면 새 묶음을 연다.
const groupDigestEntries = (
  entries: RunVerdictDigestCardEntry[],
): RunVerdictDigestCardEntry[][] =>
  entries.reduce<RunVerdictDigestCardEntry[][]>((groups, entry) => {
    const last = groups.at(-1);
    const fits =
      last !== undefined &&
      countGroupBlocks(last) + countEntryBlocks(entry) <=
        SLACK_MESSAGE_BLOCK_LIMIT;
    if (fits) {
      last.push(entry);
      return groups;
    }
    return [...groups, [entry]];
  }, []);

const buildDigestEntryBlocks = (
  entry: RunVerdictDigestCardEntry,
): SlackBlock[] => {
  const quote = formatRunVerdictQuote(
    entry.quote,
    getRunVerdictQuoteLabel(entry.facets),
  );
  const facetBlocks = entry.facets.flatMap((facet) =>
    buildRunVerdictFacetBlocks({
      agentRunId: entry.agentRunId,
      facet,
      facets: entry.facets,
      chosen: [],
    }),
  );
  const dateAndQuote: SlackBlock = {
    type: 'section',
    text: { type: 'mrkdwn', text: `*${entry.dateLabel}*\n${quote}` },
  };
  return [dateAndQuote, ...facetBlocks];
};

interface RunVerdictDigestInput {
  heading: string;
  entries: RunVerdictDigestCardEntry[];
}

// 주간 판정 카드 — 축(agentType) 하나에 한 통(넘치면 여러 통). 실행마다 날짜·인용 한 블록, 축마다 물음 + 버튼.
export const buildRunVerdictDigestPages = ({
  heading,
  entries,
}: RunVerdictDigestInput): RunVerdictDigestPage[] => {
  const groups = groupDigestEntries(entries);
  const pageMark = (index: number): string =>
    groups.length > 1 ? ` (${index + 1}/${groups.length})` : '';
  return groups.map((group, index) => [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${heading}* — 지난주 판정 안 된 ${entries.length}건, 누른 것만 셉니다.${pageMark(index)}`,
      },
    },
    ...group.flatMap(buildDigestEntryBlocks),
  ]);
};

const parseRunVerdictStatusBlockId = (
  blockId: unknown,
): RunVerdictStatusTarget | undefined => {
  if (typeof blockId !== 'string') {
    return undefined;
  }
  const matched = RUN_VERDICT_STATUS_BLOCK_ID_PATTERN.exec(blockId);
  if (!matched || !isRunVerdictFacet(matched[2])) {
    return undefined;
  }
  return { agentRunId: Number(matched[1]), facet: matched[2] };
};

// 메시지에 실린 상태 줄 전부. 비어 있으면 상태 줄 block_id 를 달기 전(2026-10-28 이전)에 나간 댓글이다.
export const readRunVerdictStatusTargets = (
  blocks: SlackBlock[],
): RunVerdictStatusTarget[] => {
  const targets = blocks.map((block) =>
    parseRunVerdictStatusBlockId(block.block_id),
  );
  return targets.filter(
    (target): target is RunVerdictStatusTarget => target !== undefined,
  );
};

interface RefreshRunVerdictStatusesInput {
  blocks: SlackBlock[];
  // 실행 id → 그 실행에 내려진 판정.
  verdictsByRun: ReadonlyMap<number, RunVerdictChoices>;
}

// 상태 줄만 원장 값으로 다시 쓰고 나머지 블록(머리·인용·버튼)은 그대로 둔다. 상태 줄을 전부 다시
// 쓰므로 action body 의 메시지가 직전 갱신보다 오래된 사본이어도 결과는 최신이다.
export const refreshRunVerdictStatuses = ({
  blocks,
  verdictsByRun,
}: RefreshRunVerdictStatusesInput): SlackBlock[] =>
  blocks.map((block) => {
    const target = parseRunVerdictStatusBlockId(block.block_id);
    if (!target) {
      return block;
    }
    const chosen = verdictsByRun.get(target.agentRunId)?.get(target.facet);
    const text = formatRunVerdictStatus({
      facet: target.facet,
      chosen: chosen ?? [],
    });
    return { ...block, text: { type: 'mrkdwn', text } };
  });

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
