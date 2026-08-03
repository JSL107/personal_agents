import {
  SecretariatDecision,
  SecretariatDigest,
} from '../../autopilot/domain/secretariat.digest';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// 승인 대기·막힌 것 목록에 붙는 상세 줄 수 상한. 넘으면 "외 N건" 으로 접는다.
// 비서실의 목적이 "한 장" 이라 목록이 길어지면 그 자체로 실패다.
const DETAIL_LINE_LIMIT = 3;

// ① 완료는 한 줄 인라인이라 종류가 많으면 줄이 화면을 넘는다. 실측(2026-08-03)에서 하루
// 13종이 나와 한 줄을 가득 채웠다 — 총 건수를 앞세우고 상위 몇 개만 남긴다.
const COMPLETED_INLINE_LIMIT = 5;

const formatRemaining = (expiresAt: Date, now: Date): string => {
  const minutes = Math.round((expiresAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) {
    return '곧 만료';
  }
  if (minutes < 60) {
    return `${minutes}분 뒤 만료`;
  }
  return `${Math.round(minutes / 60)}시간 뒤 만료`;
};

const withOverflow = (lines: string[], total: number): string[] => {
  if (total <= DETAIL_LINE_LIMIT) {
    return lines;
  }
  return [...lines, `   • 외 ${total - DETAIL_LINE_LIMIT}건`];
};

const formatCompleted = (completed: SecretariatDigest['completed']): string => {
  if (completed.length === 0) {
    return '없음';
  }
  const total = completed.reduce((sum, row) => sum + row.count, 0);
  const head = completed
    .slice(0, COMPLETED_INLINE_LIMIT)
    .map((row) => `${row.agentType} ${row.count}`)
    .join(' · ');
  if (completed.length <= COMPLETED_INLINE_LIMIT) {
    return `${total}건 · ${head}`;
  }
  return `${total}건 · ${head} 외 ${completed.length - COMPLETED_INLINE_LIMIT}종`;
};

const formatDecision = (
  decision: SecretariatDecision | null,
  now: Date,
): string => {
  if (decision === null) {
    return '없음';
  }
  if (decision.kind === 'APPROVAL') {
    return `${escapeSlackMrkdwn(decision.label)} 승인 (${formatRemaining(decision.expiresAt, now)})`;
  }
  // "연속" 이라고 쓰지 않는다 — 관측 창 안의 실패 건수일 뿐, 사이에 성공이 있었는지는
  // 이 숫자로 알 수 없다. 다만 마지막 종료가 실패인 것만 여기까지 오므로 미복구는 확실하다.
  return `${decision.agentType} ${decision.count}건 실패, 아직 복구 안 됨 — ${escapeSlackMrkdwn(decision.reason)}`;
};

/**
 * 비서실 한 장 — 다섯 항목 고정 순서. LLM 없이 순수 포맷.
 *
 * 에이전트가 낸 자유 텍스트(실패 이유·승인 카드 제목)는 그대로 두면 Slack 이 `<...>` 를
 * 링크 태그로 오인해 문장이 잘리므로 escape 한다.
 */
export const formatSecretariat = (
  digest: SecretariatDigest,
  firedAtKst: string,
  now: Date,
): string => {
  const lines = [`📋 *비서실* — ${firedAtKst} · 지난 24시간`, ''];

  lines.push(`*① 완료* — ${formatCompleted(digest.completed)}`);

  const inProgress =
    digest.inProgress.length === 0 ? '없음' : digest.inProgress.join(' · ');
  lines.push(`*② 진행 중* — ${inProgress}`);

  if (digest.approvals.length === 0) {
    lines.push('*③ 대표 승인 대기* — 없음');
  } else {
    lines.push(`*③ 대표 승인 대기* — ${digest.approvals.length}건`);
    lines.push(
      ...withOverflow(
        digest.approvals
          .slice(0, DETAIL_LINE_LIMIT)
          .map(
            (row) =>
              `   • ${escapeSlackMrkdwn(row.label)} — ${formatRemaining(row.expiresAt, now)}`,
          ),
        digest.approvals.length,
      ),
    );
  }

  if (digest.blocked.length === 0) {
    lines.push('*④ 막힌 것* — 없음');
  } else {
    lines.push(`*④ 막힌 것* — ${digest.blocked.length}종`);
    lines.push(
      ...withOverflow(
        digest.blocked
          .slice(0, DETAIL_LINE_LIMIT)
          .map(
            (row) =>
              `   • ${row.agentType} ${row.count}건 — ${escapeSlackMrkdwn(row.reason)}`,
          ),
        digest.blocked.length,
      ),
    );
  }

  lines.push(`*⑤ 오늘 결정할 것* — ${formatDecision(digest.decision, now)}`);

  return lines.join('\n');
};
