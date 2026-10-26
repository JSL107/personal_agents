import { wrapUntrustedInput } from '../../../common/llm/untrusted-input.util';
import {
  CollectedItem,
  HumanizeResearchSource,
  Processed,
} from './humanize-research.type';

export const HUMANIZE_RESEARCH_INPUT_LIMIT = 60_000;

const PRIORITY: Record<HumanizeResearchSource, number> = {
  [HumanizeResearchSource.BLOG]: 0,
  [HumanizeResearchSource.HUMANIZER]: 1,
  [HumanizeResearchSource.SAMPLE]: 2,
  [HumanizeResearchSource.UPSTREAM]: 3,
  [HumanizeResearchSource.ARXIV]: 4,
};

export interface ResearchInputSelection {
  prompt: string;
  included: CollectedItem[];
  droppedForBudget: string[];
}

const renderItem = (item: CollectedItem): string => {
  const text =
    item.source === HumanizeResearchSource.HUMANIZER
      ? item.text
      : wrapUntrustedInput(item.text);
  return `[item id=${item.id} source=${item.source}]\n${text}`;
};

export const selectResearchInput = ({
  items,
  quickRules,
  systemPrompt,
}: {
  items: readonly CollectedItem[];
  quickRules: string;
  systemPrompt: string;
}): ResearchInputSelection => {
  const prefix = `정본 references/quick-rules.md:\n${quickRules}\n\n수집물:\n`;
  const available =
    HUMANIZE_RESEARCH_INPUT_LIMIT - systemPrompt.length - prefix.length;
  if (available < 0) {
    throw new Error('정본 규칙이 윤문 규칙 연구 입력 예산을 초과함');
  }
  const ordered = [...items].sort(
    (left, right) => PRIORITY[left.source] - PRIORITY[right.source],
  );
  const included: CollectedItem[] = [];
  const droppedForBudget: string[] = [];
  let used = 0;
  for (const item of ordered) {
    const rendered = renderItem(item);
    const cost = rendered.length + 2;
    if (used + cost > available) {
      droppedForBudget.push(item.id);
      continue;
    }
    included.push(item);
    used += cost;
  }
  const prompt = prefix + included.map(renderItem).join('\n\n');
  return { prompt, included, droppedForBudget };
};

export const advanceProcessed = ({
  previous,
  included,
}: {
  previous: Processed;
  included: readonly CollectedItem[];
}): Processed => {
  const humanizerIds = included
    .filter((item) => item.source === HumanizeResearchSource.HUMANIZER)
    .map((item) => Number(item.id.match(/-(\d+)$/u)?.[1]))
    .filter(Number.isFinite);
  const previousId = Number(previous.humanizerMaxRunId ?? 0);
  const maxId = Math.max(previousId, ...humanizerIds);
  const blogPostIds = [
    ...new Set([
      ...previous.blogPostIds,
      ...included
        .filter((item) => item.source === HumanizeResearchSource.BLOG)
        .map((item) => item.id),
    ]),
  ];
  const upstream = included.find(
    (item) => item.source === HumanizeResearchSource.UPSTREAM,
  );
  const arxivIds = included
    .filter((item) => item.source === HumanizeResearchSource.ARXIV)
    .map((item) => item.id);
  return {
    humanizerMaxRunId: maxId > 0 ? String(maxId) : null,
    blogPostIds,
    upstreamHead:
      upstream?.id.slice('upstream:'.length) ?? previous.upstreamHead,
    arxivIds,
  };
};
