import { getKstDateOf } from '../../common/util/kst-date.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { TriggerType } from './agent-run.type';
import { RunVerdictFacet } from './run-verdict';

// 주간 판정 카드 — 지난주 매일 버튼으로 판정받지 못한 실행을 월요일 아침 스레드에 모아 다시 묻는다.
// 매일 버튼은 그대로 두고 이 카드는 보충이다(2026-10-28 결정: 매일 누름률이 10~20% 로 떨어졌고,
// 클릭은 실시간이 아니라 며칠 치를 몰아서 눌렸다). 설계: 2026-09-30-human-feedback-channel-design.md §2 D안·§7.
//
// 대상은 매일 버튼이 붙는 cron 실행뿐이다 — 수동 /today 처럼 버튼이 나간 적 없는 실행은 묻지 않는다.
// `heading` 은 주간 카드 머리. 매일 댓글 머리("오늘 아침 계획 판정")를 쓰면 지난주 실행이 오늘 것으로 읽힌다.
export const RUN_VERDICT_DIGEST_SOURCES: readonly {
  agentType: AgentType;
  triggerType: TriggerType;
  heading: string;
}[] = [
  {
    agentType: AgentType.EVENING_RETRO,
    triggerType: TriggerType.AUTOPILOT_EVENING_RETRO_CRON,
    heading: '🌙 저녁 회고 주간 판정',
  },
  {
    agentType: AgentType.PO_SHADOW,
    triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
    heading: '🎯 PO 대행 주간 판정',
  },
  {
    agentType: AgentType.PM,
    triggerType: TriggerType.MORNING_BRIEFING_CRON,
    heading: '🗓️ 아침 계획 주간 판정',
  },
];

export interface RunVerdictDigestRun {
  id: number;
  agentType: string;
  startedAt: Date;
  output: unknown;
  // 이 실행에 이미 내려진 판정의 축 — 누가 눌렀든 한 번이라도 눌린 축은 다시 묻지 않는다.
  judgedFacets: string[];
}

export interface RunVerdictDigestEntry {
  agentRunId: number;
  startedAt: Date;
  facets: RunVerdictFacet[];
  quote: string;
}

export interface RunVerdictDigestCard {
  agentType: string;
  heading: string;
  entries: RunVerdictDigestEntry[];
}

// 한 실행에서 아직 묻지 않은 축과, 그 축들을 판정할 때 보여 줄 인용.
interface RunVerdictTarget {
  facets: RunVerdictFacet[];
  quote?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim() || undefined;
};

const PM_PLAN_QUOTE_ITEM_LIMIT = 3;

// 아침 계획의 인용 — 최우선 1건과 오전 항목 제목. 판정 댓글은 저녁(또는 다음 주)에 보이므로
// 무슨 계획이었는지 인용이 없으면 "쓸모 있었나" 를 답할 수 없다(2026-10-28 사용자 피드백).
export const formatPmPlanQuote = (output: unknown): string | undefined => {
  const plan = asRecord(output);
  if (!plan) {
    return undefined;
  }
  const morning = Array.isArray(plan.morning) ? plan.morning : [];
  const titles = [
    readText(asRecord(plan.topPriority)?.title),
    ...morning.map((item) => readText(asRecord(item)?.title)),
  ].filter((title): title is string => title !== undefined);
  const unique = [...new Set(titles)].slice(0, PM_PLAN_QUOTE_ITEM_LIMIT);
  return unique.length > 0 ? unique.join(' / ') : undefined;
};

// 실행 하나에서 아직 판정 안 된 축과 인용. 축 규칙은 매일 버튼과 같다 — 저녁 회고는 아쉬운 점이 빈 날
// 그 축을 내지 않고, PO 대행은 조용한 회차(quiet)에 버튼을 내지 않았다. 인용은 남은 축에 맞춘다:
// 아쉬운 점이 이미 판정되고 회고 전체만 남았으면 아쉬운 점 한 줄이 아니라 회고 내용을 보여 준다.
// 원장 output 은 윤문 전 문장이라 매일 댓글의 인용과 표현이 조금 다를 수 있다.
const describeRun = (run: RunVerdictDigestRun): RunVerdictTarget | null => {
  const output = asRecord(run.output);
  const unjudged = (facets: RunVerdictFacet[]): RunVerdictFacet[] =>
    facets.filter((facet) => !run.judgedFacets.includes(facet));
  switch (run.agentType) {
    case AgentType.EVENING_RETRO: {
      const retrospective = asRecord(output?.retrospective);
      const problem = readText(retrospective?.problem);
      const facets = unjudged(
        problem ? ['retro_problem', 'overall'] : ['overall'],
      );
      const summary = ['keep', 'tryNext', 'carryOver']
        .map((key) => readText(retrospective?.[key]))
        .find((text) => text !== undefined);
      const quote = facets.includes('retro_problem')
        ? problem
        : (summary ?? problem);
      return { facets, quote };
    }
    case AgentType.PO_SHADOW: {
      const headline = readText(output?.headline);
      if (output?.quiet === true || !headline) {
        return null;
      }
      return { facets: unjudged(['po_first_action']), quote: headline };
    }
    case AgentType.PM:
      return {
        facets: unjudged(['pm_plan']),
        quote: formatPmPlanQuote(run.output),
      };
    default:
      return null;
  }
};

// 같은 날 같은 종류의 실행이 여럿이면 마지막 것만 남긴다. 발송이 실패하면 오케스트레이터가 다시 던져
// BullMQ 가 task 를 다시 돌리므로, 앞선 실행은 사람에게 나가지 않았고 마지막 시도가 나간 것이다.
// 매일 저녁의 아침 계획 판정도 그날 마지막 실행 한 건만 묻는다.
// ponytail: 마지막 시도까지 모두 실패한 날은 호출부의 발송 확인이 거른다 — 그날 안에서 시도별 발송을
// 가르지는 못한다(원장에 agentRunId 가 없다).
const keepLatestPerDay = (
  runs: RunVerdictDigestRun[],
): RunVerdictDigestRun[] => {
  const latest = new Map<string, RunVerdictDigestRun>();
  for (const run of runs) {
    const key = `${run.agentType}:${getKstDateOf(run.startedAt)}`;
    const kept = latest.get(key);
    if (!kept || kept.startedAt < run.startedAt) {
      latest.set(key, run);
    }
  }
  return [...latest.values()];
};

// 인용이 없으면 일주일 뒤에 무엇을 판정하는지 알 수 없다 — 버튼만 있는 항목은 내지 않는다.
const toDigestEntry = (run: RunVerdictDigestRun): RunVerdictDigestEntry[] => {
  const target = describeRun(run);
  if (!target?.quote || target.facets.length === 0) {
    return [];
  }
  return [
    {
      agentRunId: run.id,
      startedAt: run.startedAt,
      facets: target.facets,
      quote: target.quote,
    },
  ];
};

const byStartedAt = (
  left: RunVerdictDigestRun,
  right: RunVerdictDigestRun,
): number => left.startedAt.getTime() - right.startedAt.getTime();

// 판정 안 된 축만 남긴 실행을 agentType 별 카드로 묶는다. 카드 순서는 RUN_VERDICT_DIGEST_SOURCES,
// 카드 안은 실행 시각 순. 묻을 것이 없는 카드는 내지 않는다.
export const selectRunVerdictDigestCards = (
  runs: RunVerdictDigestRun[],
): RunVerdictDigestCard[] => {
  const candidates = keepLatestPerDay(runs).sort(byStartedAt);
  const cards = RUN_VERDICT_DIGEST_SOURCES.map(({ agentType, heading }) => {
    const ofType = candidates.filter((run) => run.agentType === agentType);
    return { agentType, heading, entries: ofType.flatMap(toDigestEntry) };
  });
  return cards.filter((card) => card.entries.length > 0);
};
