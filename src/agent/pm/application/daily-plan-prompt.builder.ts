import { Injectable, Logger } from '@nestjs/common';

import { formatGithubTasksAsPromptSection } from '../domain/prompt/github-task-formatter';
import { formatNotionTasksAsPromptSection } from '../domain/prompt/notion-task-formatter';
import { formatPreviousDailyPlanSection } from '../domain/prompt/previous-plan-formatter';
import { formatPreviousDailyReviewSection } from '../domain/prompt/previous-worklog-formatter';
import { formatRecentPlanSummariesSection } from '../domain/prompt/recent-plan-summary-formatter';
import { formatSlackMentionsAsPromptSection } from '../domain/prompt/slack-mention-formatter';
import {
  DailyPlanContext,
  SLACK_MENTION_SINCE_HOURS,
} from './daily-plan-context.collector';

// 합쳐진 prompt 의 byte 길이 상한. 초과 시 lower-priority section 부터 drop.
// Codex/Claude/Gemini CLI 모두 안전한 보수치 (~16KB UTF-8 기준 4-8K 토큰).
const MAX_PROMPT_BYTES = 16_000;

// section drop 우선순위 — 인덱스 0 부터 차례로 drop.
// userText / github / notion 은 절대 drop 하지 않는다 — empty guard 를 통과한 유일한 task source 가 잘려
// 모델이 빈 prompt 로 호출되는 regression (codex review b1309omm0 P2) 방지.
// V3-1: 새 섹션 recentPlanSummaries 는 7일치 패턴 (참고용) 이라 직전 plan/worklog 보다 먼저 drop.
const TRIM_ORDER: ReadonlyArray<keyof PromptSections> = [
  'slackMentions',
  'recentPlanSummaries',
  'previousWorklog',
  'previousPlan',
];

interface PromptSections {
  previousPlan: string | null;
  previousWorklog: string | null;
  slackMentions: string | null;
  userText: string | null;
  github: string | null;
  notion: string | null;
  recentPlanSummaries: string | null;
}

export interface TruncationMeta {
  github: number;
  notion: number;
  slackMentions: number;
  droppedSections: string[];
}

export interface BuiltPrompt {
  prompt: string;
  truncated: TruncationMeta;
}

// DailyPlanContext → 최종 prompt string + truncation meta.
// 각 source 별 단일 cap (formatter 내부) 후 전체 byte cap (여기 trim) 을 순차 적용.
@Injectable()
export class DailyPlanPromptBuilder {
  private readonly logger = new Logger(DailyPlanPromptBuilder.name);

  build(context: DailyPlanContext): BuiltPrompt {
    const { userText, githubTasks, previousPlan, previousWorklog } = context;
    const { slackMentions, notionTasks, recentPlanSummaries } = context;

    const githubResult = githubTasks
      ? formatGithubTasksAsPromptSection(githubTasks)
      : null;
    const notionResult =
      notionTasks.length > 0
        ? formatNotionTasksAsPromptSection(notionTasks)
        : null;
    const slackResult =
      slackMentions.length > 0
        ? formatSlackMentionsAsPromptSection({
            mentions: slackMentions,
            sinceHours: SLACK_MENTION_SINCE_HOURS,
          })
        : null;

    const sections: PromptSections = {
      previousPlan: previousPlan
        ? formatPreviousDailyPlanSection({
            plan: previousPlan.plan,
            endedAt: previousPlan.endedAt,
          })
        : null,
      previousWorklog: previousWorklog
        ? formatPreviousDailyReviewSection({
            review: previousWorklog.review,
            endedAt: previousWorklog.endedAt,
          })
        : null,
      slackMentions: slackResult ? slackResult.content : null,
      userText: userText.length > 0 ? `[사용자 입력]\n${userText}` : null,
      github: githubResult ? githubResult.content : null,
      notion: notionResult ? notionResult.content : null,
      recentPlanSummaries:
        formatRecentPlanSummariesSection(recentPlanSummaries),
    };

    const droppedSections = this.trimSectionsToFit(sections);

    const joined = (Object.keys(sections) as Array<keyof PromptSections>)
      .map((key) => sections[key])
      .filter((value): value is string => value !== null)
      .join('\n\n');

    // 최종 guard — core section (userText/github/notion) 이 단독으로 cap 초과하는 경우 tail truncate.
    // codex review bcpccaqik P2 대응: drop 만으로 cap 을 보장할 수 없는 엣지케이스 방어.
    const joinedBytes = Buffer.byteLength(joined, 'utf8');
    const needsTruncate = joinedBytes > MAX_PROMPT_BYTES;
    if (needsTruncate) {
      this.logger.warn(
        `drop 후에도 prompt 가 ${MAX_PROMPT_BYTES} bytes 초과 (${joinedBytes}) — tail truncate 로 강제 cap 적용`,
      );
      if (!droppedSections.includes('__TAIL_TRUNCATED__')) {
        droppedSections.push('__TAIL_TRUNCATED__');
      }
    }
    const prompt = needsTruncate
      ? truncateUtf8(joined, MAX_PROMPT_BYTES)
      : joined;

    return {
      prompt,
      truncated: {
        github: githubResult?.truncatedCount ?? 0,
        notion: notionResult?.truncatedCount ?? 0,
        slackMentions: slackResult?.truncatedCount ?? 0,
        droppedSections,
      },
    };
  }

  // sections 의 byte length 합이 MAX_PROMPT_BYTES 초과 시 TRIM_ORDER 인덱스 0 부터 drop.
  // mutates sections in-place. drop 된 section 이름 배열 반환 (메트릭/로그용).
  private trimSectionsToFit(sections: PromptSections): string[] {
    const dropped: string[] = [];
    for (const key of TRIM_ORDER) {
      if (this.computeJoinedByteLength(sections) <= MAX_PROMPT_BYTES) {
        return dropped;
      }
      if (sections[key] !== null) {
        sections[key] = null;
        dropped.push(key);
        this.logger.warn(
          `prompt 가 ${MAX_PROMPT_BYTES} bytes 초과 — section "${key}" drop`,
        );
      }
    }
    return dropped;
  }

  // 생략 안내 (없으면 생략) — tail truncate 시 사용자가 "왜 뒷부분이 잘렸는지" 알 수 있도록.
  // 기본 tail 에서 "\n\n... (생략됨 — prompt size cap)" 을 뺀 길이로 자른다.

  private computeJoinedByteLength(sections: PromptSections): number {
    const joined = (Object.keys(sections) as Array<keyof PromptSections>)
      .map((key) => sections[key])
      .filter((value): value is string => value !== null)
      .join('\n\n');
    return Buffer.byteLength(joined, 'utf8');
  }
}

const TRUNCATE_SUFFIX = '\n\n... (생략됨 — prompt size cap)';

// UTF-8 멀티바이트 경계를 보존하며 지정 byte 이하로 tail truncate.
// 정확한 byte 계산을 위해 Buffer 로 변환 후 char 경계에서 자른다.
const truncateUtf8 = (text: string, maxBytes: number): string => {
  const suffixBytes = Buffer.byteLength(TRUNCATE_SUFFIX, 'utf8');
  const targetBytes = Math.max(0, maxBytes - suffixBytes);
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= targetBytes) {
    return text;
  }
  // 뒤에서 byte 잘린 경우 중간에 멀티바이트가 쪼개질 수 있으므로 toString 후 replacement char 제거.
  // utf8 decoder 가 invalid sequence 를 U+FFFD (�) 로 바꿀 수 있으니 말미에 남았으면 drop.
  const sliced = buffer
    .subarray(0, targetBytes)
    .toString('utf8')
    .replace(/�$/, '');
  return `${sliced}${TRUNCATE_SUFFIX}`;
};
