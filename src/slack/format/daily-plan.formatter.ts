import {
  DailyPlan,
  StalledTask,
  TaskItem,
} from '../../agent/pm/domain/pm-agent.type';
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

const renderStalledTaskLine = (task: StalledTask): string => {
  const title =
    task.url && task.url.length > 0 && isSafeHttpUrl(task.url)
      ? `<${sanitizeForSlackLink(task.url)}|${sanitizeForSlackLink(task.title)}>`
      : task.title;
  return `• ${title} (${task.daysStalled}일째) — 종결/위임/보류`;
};

// summary(메인) = 오늘 할 일만 — 과제 목록 · Blocker · 예상 소요.
// detail(스레드) = 왜 그렇게 정했나 — 판단 근거 · 어제 이월 · 정체 항목.
//
// 전에는 판단 근거가 메인 최상단에 있었다. 실측(2026-09-18, 실제 산출물을 formatter 에 통과시킨
// 결과)에서 메인이 2,024자 · 39줄이었고 그중 앞 4줄 330자가 근거였다 — 오늘 무엇을 할지는
// 6행에야 나왔다. 아직 할 일을 모르는 상태에서 "#2808 을 강등했다" 를 먼저 읽는 구조라
// 「엥?」 하게 된다는 지적을 받았다.
//
// 어제 이월도 내린다. 같은 실측에서 오늘 과제는 3건인데 이월 목록이 11줄이었다 — 오늘 하지
// 않는 것이 하는 것보다 3배 길었다.
//
// 아무것도 버리지 않고 자리만 옮긴다. autopilot 이 detail 을 같은 스레드 댓글로 보내므로
// (autopilot.orchestrator 의 threadTs 경로) 근거가 궁금하면 스레드를 열면 된다.
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

  summaryLines.push('', `*예상 소요*: ${plan.estimatedHours}시간`);

  const detailSections: string[] = [];

  if (plan.reasoning.trim().length > 0) {
    detailSections.push(`*판단 근거*\n${plan.reasoning}`);
  }

  // 이월 항목이 없어도 analysisReasoning 이 있으면 "왜 drop 했는지" 설명을 노출 —
  // Rollover 자율권 (Eisenhower 매트릭스) 판단 근거가 사용자에게 보여야 함 (codex review bi531458d P3).
  const { rolledOverTasks, analysisReasoning } = plan.varianceAnalysis;
  if (rolledOverTasks.length > 0 || analysisReasoning.length > 0) {
    const rolloverLines = ['*어제 이월*'];
    if (rolledOverTasks.length > 0) {
      rolloverLines.push(...rolledOverTasks.map((t) => `• ${t}`));
    }
    if (analysisReasoning.length > 0) {
      rolloverLines.push(`_이월 근거_: ${analysisReasoning}`);
    }
    detailSections.push(rolloverLines.join('\n'));
  }

  const stalledTasks = plan.stalledTasks ?? [];
  if (stalledTasks.length > 0) {
    detailSections.push(
      [
        '*정체 항목 (결정 필요)*',
        ...stalledTasks.map(renderStalledTaskLine),
      ].join('\n'),
    );
  }

  // 뒤에 무엇이 오는지 메인 끝에서 알린다 — 안 그러면 근거가 사라진 것으로 보인다.
  // 이월은 건수를 함께 적는다. 「11건」 을 보고 열지 말지 정할 수 있어야 한다.
  //
  // 「스레드」 라고 쓰지 않는다. 이 값은 두 경로로 나가는데 한쪽에서만 스레드다 —
  // cron 은 detail 을 스레드 댓글로 보내지만(autopilot.orchestrator), 슬래시(`/today`)는
  // ephemeral 응답이라 스레드를 달 수 없어 `summary + detail` 합본으로 나간다
  // (slack-handler.helper 의 toSlackText). 합본에서 「스레드」 라고 가리키면 바로 아래 이어지는
  // 본문을 두고 거짓말이 된다. 👇 는 두 경로 모두에서 참이다.
  const threadHints: string[] = [];
  if (plan.reasoning.trim().length > 0) {
    threadHints.push('판단 근거');
  }
  if (rolledOverTasks.length > 0) {
    threadHints.push(`어제 이월 ${rolledOverTasks.length}건`);
  } else if (analysisReasoning.length > 0) {
    threadHints.push('이월 근거');
  }
  if (stalledTasks.length > 0) {
    threadHints.push(`정체 항목 ${stalledTasks.length}건`);
  }
  if (threadHints.length > 0) {
    // 목록 뒤에 조사를 붙이지 않는다 — 마지막 항목의 받침에 따라 은/는이 갈리는데
    // 고정 조사를 쓰면 「정체 항목 1건 는」 처럼 어긋난다.
    summaryLines.push('', `_👇 ${threadHints.join(' · ')}_`);
  }

  return {
    summary: summaryLines.join('\n'),
    detail: detailSections.join('\n\n'),
  };
};
