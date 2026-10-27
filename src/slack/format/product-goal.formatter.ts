import {
  GoalDeclarationProblem,
  MAX_ACTIVE_DIRECTION_GOALS,
  MAX_ACTIVE_PRODUCT_GOALS,
  ProductGoalDraft,
  ProductGoalRecord,
} from '../../agent/po-shadow/domain/product-goal';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const DECLARE_EXAMPLE =
  '이번 분기 목표는 보존기간 파일 파기, 달성 기준은 sbe-api-v5 운영 배포 완료, 기한 12월 31일';

export const formatGoalList = (goals: ProductGoalRecord[]): string => {
  if (goals.length === 0) {
    return `🧭 활성 제품 목표가 없습니다. "${DECLARE_EXAMPLE}" 처럼 선언해 주세요.`;
  }
  const taskCount = goals.filter((goal) => goal.kind === 'TASK').length;
  const directionCount = goals.filter(
    (goal) => goal.kind === 'DIRECTION',
  ).length;
  const lines = goals.map((goal) => {
    if (goal.kind === 'DIRECTION') {
      const why =
        goal.why === null ? '' : `\n  왜: ${escapeSlackMrkdwn(goal.why)}`;
      return `• 🧭 *${escapeSlackMrkdwn(goal.title)}* (방향)${why}`;
    }
    const criterion =
      goal.successCriterion === null
        ? ''
        : ` — 달성 기준: ${escapeSlackMrkdwn(goal.successCriterion)}`;
    return `• *${escapeSlackMrkdwn(goal.title)}*${criterion}${formatDueDate(goal.dueDate)}\n  키워드: ${escapeSlackMrkdwn(goal.keywords.join(', '))}`;
  });
  return [
    `🧭 *활성 목표* — 숙제 ${taskCount}/${MAX_ACTIVE_PRODUCT_GOALS} · 방향 ${directionCount}/${MAX_ACTIVE_DIRECTION_GOALS}`,
    ...lines,
  ].join('\n');
};

export interface GoalCreatePreviewOptions {
  otherGoalTitles?: string[];
  conversation?: boolean;
  directionCriterionHint?: boolean;
}

// 확인 카드 본문. 키워드는 제목에서 자동으로 뽑았을 수 있으므로 저장 전에 반드시 보여 준다 —
// 키워드가 엉뚱하면 목표 밖 작업 판정이 통째로 틀린다.
export const formatGoalCreatePreview = (
  draft: ProductGoalDraft,
  options: GoalCreatePreviewOptions = {},
): string => {
  const lines = [
    '🧭 *이렇게 저장할까요?*',
    `• 종류: ${draft.kind === 'DIRECTION' ? '🧭 방향' : '✅ 숙제'}`,
    `• 목표: ${escapeSlackMrkdwn(draft.title)}`,
  ];
  if (draft.why !== null) {
    lines.push(`• 왜: ${escapeSlackMrkdwn(draft.why)}`);
  }
  if (draft.kind === 'TASK') {
    lines.push(
      `• 달성 기준: ${escapeSlackMrkdwn(draft.successCriterion ?? '')}`,
    );
  }
  lines.push(`• 기한: ${draft.dueDate ?? '없음'}`);
  if (draft.kind === 'TASK') {
    lines.push(`• 키워드: ${escapeSlackMrkdwn(draft.keywords.join(', '))}`);
  }
  if (options.directionCriterionHint) {
    lines.push('_끝 기준을 정하기 어려워 방향으로 제안드려요._');
  }
  if (options.otherGoalTitles?.length) {
    const titles = options.otherGoalTitles.map(escapeSlackMrkdwn).join(', ');
    lines.push(`_함께 말한 목표: ${titles} — 승인 뒤 다시 말해 주세요._`);
  }
  lines.push(
    options.conversation
      ? '_종류나 내용을 바꾸려면 고칠 내용을 그대로 답장해 주세요._'
      : '_키워드가 들어간 PR·이슈를 이 목표의 작업으로 봅니다. 바꾸려면 "키워드 a, b" 를 붙여 다시 선언해 주세요._',
  );
  return lines.join('\n');
};

export const formatGoalClosePreview = (goal: ProductGoalRecord): string =>
  `🧭 *"${escapeSlackMrkdwn(goal.title)}" 목표를 닫을까요?*\n_닫으면 PO 검토가 이 목표를 기준으로 삼지 않습니다._`;

export const formatGoalProblem = (
  problem: GoalDeclarationProblem,
  activeGoals: ProductGoalRecord[],
): string => {
  switch (problem) {
    case 'MISSING_TITLE':
      return `🧭 목표 제목을 읽지 못했어요. "${DECLARE_EXAMPLE}" 처럼 말해 주세요.`;
    case 'MISSING_CRITERION':
      return `🧭 달성 기준이 없어 저장하지 않았어요. 무엇을 달성으로 볼지 한 줄로 붙여 다시 선언해 주세요.\n예: "${DECLARE_EXAMPLE}"`;
    case 'MISSING_KEYWORDS':
      return '🧭 이 목표에 붙일 작업을 찾을 키워드가 없어요. "키워드 a, b" 를 붙여 다시 선언해 주세요.';
    case 'UNREADABLE_DUE_DATE':
      return '🧭 기한을 날짜로 읽지 못했어요. "기한 12월 31일" 이나 "기한 2026-12-31" 처럼 말해 주세요.';
    case 'DUPLICATE_TITLE':
      return '🧭 같은 제목의 활성 목표가 이미 있어 저장하지 않았어요. 다른 제목으로 선언하거나 기존 목표를 닫아 주세요.';
    case 'ACTIVE_LIMIT_REACHED':
      return [
        `🧭 숙제가 ${MAX_ACTIVE_PRODUCT_GOALS}개 차 있어요. 하나를 닫을까요?`,
        ...activeGoals
          .filter((goal) => goal.kind === 'TASK')
          .map((goal) => `• ${escapeSlackMrkdwn(goal.title)}`),
        '_"<제목> 목표 닫아줘" 로 닫은 뒤 다시 선언해 주세요._',
      ].join('\n');
    case 'DIRECTION_LIMIT_REACHED':
      return [
        `🧭 방향 목표가 ${MAX_ACTIVE_DIRECTION_GOALS}개 차 있어요. 하나를 닫을까요?`,
        ...activeGoals
          .filter((goal) => goal.kind === 'DIRECTION')
          .map((goal) => `• ${escapeSlackMrkdwn(goal.title)}`),
        '_"<제목> 목표 닫아줘" 로 닫은 뒤 다시 선언해 주세요._',
      ].join('\n');
  }
};

export const formatGoalCloseNotFound = (
  titleQuery: string,
  activeGoals: ProductGoalRecord[],
): string => {
  const head =
    titleQuery.length === 0
      ? '🧭 어느 목표를 닫을지 제목을 알려 주세요.'
      : `🧭 "${escapeSlackMrkdwn(titleQuery)}" 에 맞는 활성 목표가 없어요.`;
  if (activeGoals.length === 0) {
    return `${head} 지금 활성 목표가 없습니다.`;
  }
  return [
    head,
    ...activeGoals.map((goal) => `• ${escapeSlackMrkdwn(goal.title)}`),
  ].join('\n');
};

export const formatGoalCloseAmbiguous = (
  candidates: ProductGoalRecord[],
): string =>
  [
    '🧭 여러 목표가 맞습니다. 제목을 정확히 적어 주세요.',
    ...candidates.map((goal) => `• ${escapeSlackMrkdwn(goal.title)}`),
  ].join('\n');

const formatDueDate = (dueDate: Date | null): string =>
  dueDate === null ? '' : ` (기한 ${dueDate.toISOString().slice(0, 10)})`;
