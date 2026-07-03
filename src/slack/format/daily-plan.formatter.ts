import { DailyPlan, TaskItem } from '../../agent/pm/domain/pm-agent.type';
import { FormattedReport } from './formatted-report.type';
import { isSafeHttpUrl, sanitizeForSlackLink } from './mrkdwn.util';

// lineage 라벨 prefix — PRO-2 의 어제↔오늘 추적성을 한눈에 보여줌. 라벨 없는 구버전 plan 은 prefix 생략.
const LINEAGE_LABEL: Record<NonNullable<TaskItem['lineage']>, string> = {
  NEW: '🆕 ',
  CARRIED: '🔁 ',
  POSTPONED: '⏭ ',
};

// url 이 있으면 Slack 마크다운 링크로 감싸 PR/Issue/Notion 으로 즉시 이동 가능 (PRO-2+ 이슈 A).
// http(s) 스킴이 아니면 broken link 회피 위해 단순 텍스트로 fallback (codex P0 지적).
// title/url 둘 다 mrkdwn-safe 로 sanitize 해 `|` / `>` / `<` 가 섞여도 링크 파싱 안 깨짐.
const renderTitleWithLink = (task: TaskItem): string => {
  if (task.url && task.url.length > 0 && isSafeHttpUrl(task.url)) {
    return `<${sanitizeForSlackLink(task.url)}|${sanitizeForSlackLink(task.title)}>`;
  }
  return task.title;
};

const renderTaskLine = (task: TaskItem): string => {
  const critical = task.isCriticalPath ? '⚠ ' : '';
  const lineage = task.lineage ? LINEAGE_LABEL[task.lineage] : '';
  const titled = renderTitleWithLink(task);
  const wbs =
    task.subtasks.length > 0
      ? `\n${task.subtasks
          .map((s) => `   ↳ ${s.title} (${s.estimatedMinutes}m)`)
          .join('\n')}`
      : '';
  return `• ${lineage}${critical}${titled}${wbs}`;
};

// summary(메인) = 과제 목록 + Blocker + 어제 이월 + 예상 소요, detail(스레드) = 판단 근거.
// 어제 이월의 `_이월 근거_` 는 이월 리스트와 한 블록이라 summary 에 함께 유지하고,
// 전체 계획의 `판단 근거`(reasoning) 만 스레드로 내린다.
export const formatDailyPlan = (plan: DailyPlan): FormattedReport => {
  const summaryLines: string[] = [
    '*오늘의 최우선 과제*',
    renderTaskLine(plan.topPriority),
    '',
    '*오전*',
    ...plan.morning.map(renderTaskLine),
    '',
    '*오후*',
    ...plan.afternoon.map(renderTaskLine),
  ];

  if (plan.blocker) {
    summaryLines.push('', `*Blocker*: ${plan.blocker}`);
  }

  // 이월 항목이 없어도 analysisReasoning 이 있으면 "왜 drop 했는지" 설명을 노출 —
  // Rollover 자율권 (Eisenhower 매트릭스) 판단 근거가 사용자에게 보여야 함 (codex review bi531458d P3).
  const { rolledOverTasks, analysisReasoning } = plan.varianceAnalysis;
  if (rolledOverTasks.length > 0 || analysisReasoning.length > 0) {
    summaryLines.push('', '*어제 이월*');
    if (rolledOverTasks.length > 0) {
      summaryLines.push(...rolledOverTasks.map((t) => `• ${t}`));
    }
    if (analysisReasoning.length > 0) {
      summaryLines.push(`_이월 근거_: ${analysisReasoning}`);
    }
  }

  summaryLines.push('', `*예상 소요*: ${plan.estimatedHours}시간`);

  return {
    summary: summaryLines.join('\n'),
    detail: `*판단 근거*: ${plan.reasoning}`,
  };
};
