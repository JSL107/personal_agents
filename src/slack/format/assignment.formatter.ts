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
//   _이대로 진행할까요? ... (자연어 승인/재배정 안내)_
export interface FormatAssignmentOptions {
  // 실행 승인 카드(PreviewGate CTO_BE_CHAIN)가 함께 열렸는지. true 면 "응" 안내를 붙인다.
  // 승인 카드 없이 표만 보여주는 경로(분배 0건 등)에서 "응 하세요" 라고 하면 거짓말이 된다.
  awaitingApproval?: boolean;
}

export const formatAssignmentOutput = (
  output: AssignmentOutput,
  options: FormatAssignmentOptions = {},
): string => {
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
  if (options.awaitingApproval === true) {
    lines.push(
      '*이대로 진행할까요?* `🚀 실행` 버튼을 누르거나 `응` 이라고 답해주세요.',
    );
  }
  // 배정 변경은 카드의 드롭다운이 정식 경로다. 드롭다운으로 표현되지 않는 요청
  // (우선순위, 보류로 빼기) 은 말로 받아 CTO 를 다시 태운다.
  lines.push(
    '_배정은 항목 옆 드롭다운에서 바꿀 수 있습니다. 우선순위·보류 조정은 말로 알려주세요 — 예: "3번은 빼줘"._',
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
