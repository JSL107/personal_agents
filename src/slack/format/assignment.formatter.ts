import { Assignment, AssignmentOutput } from '../../agent/cto/domain/cto.type';

// confidence 가 이 임계값 미만이면 ⚠️ 표시 — 사용자가 분배 결과를 confirm/override 권장 (codex review).
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// CTO worker 의 Slack 답글 formatter.
// 본문 구조:
//   *📋 CTO 분배 결과*
//   ctoSummary
//
//   *Priority 1 (urgent)*
//   • [BE] taskTitle — reasoning (confidence 0.9)
//   • [BE_SCHEMA] ...
//
//   *Priority 2 / 3 ...*
//
//   *⚠️ 자동 분배 보류 (사용자 결정 필요)*
//   • taskTitle — reason
//
//   _분배 결과 override: `/assign <taskId> <worker>` (TODO — 본 step 미지원)_
export const formatAssignmentOutput = (output: AssignmentOutput): string => {
  const lines: string[] = ['*📋 CTO 분배 결과*'];
  if (output.ctoSummary.trim().length > 0) {
    lines.push('');
    lines.push(escapeSlackMrkdwn(output.ctoSummary));
  }

  if (output.assignments.length > 0) {
    const byPriority = new Map<1 | 2 | 3, Assignment[]>();
    for (const a of output.assignments) {
      const bucket = byPriority.get(a.priority) ?? [];
      bucket.push(a);
      byPriority.set(a.priority, bucket);
    }
    const labels: Record<1 | 2 | 3, string> = {
      1: 'Priority 1 (urgent)',
      2: 'Priority 2 (normal)',
      3: 'Priority 3 (defer)',
    };
    for (const priority of [1, 2, 3] as const) {
      const items = byPriority.get(priority);
      if (!items || items.length === 0) {
        continue;
      }
      lines.push('');
      lines.push(`*${labels[priority]}*`);
      for (const a of items) {
        lines.push(formatAssignmentLine(a));
      }
    }
  } else {
    lines.push('');
    lines.push('_분배된 task 없음 — 모두 unassigned 로 분류됨._');
  }

  if (output.unassignedTasks.length > 0) {
    lines.push('');
    lines.push('*⚠️ 자동 분배 보류 (사용자 결정 필요)*');
    for (const u of output.unassignedTasks) {
      lines.push(
        `• ${escapeSlackMrkdwn(u.taskTitle)} — ${escapeSlackMrkdwn(u.reason)}`,
      );
    }
  }

  lines.push('');
  lines.push(
    '_분배 결과 override 는 후속 step 에서 도입 예정 — 현재는 worker 슬래시 (`/be plan|schema|test ...`) 직접 호출._',
  );

  return lines.join('\n');
};

const formatAssignmentLine = (a: Assignment): string => {
  const confidenceMark =
    a.confidence < LOW_CONFIDENCE_THRESHOLD ? ' ⚠️ confidence 낮음' : '';
  const confidenceStr = a.confidence.toFixed(2);
  return `• \`[${a.beAssignment}]\` ${escapeSlackMrkdwn(a.taskTitle)} — ${escapeSlackMrkdwn(a.reasoning)} _(confidence ${confidenceStr}${confidenceMark})_`;
};

const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
