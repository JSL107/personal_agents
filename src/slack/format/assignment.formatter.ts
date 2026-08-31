import { Assignment, AssignmentOutput } from '../../agent/cto/domain/cto.type';

// confidence 가 이 임계값 미만이면 ⚠️ 표시 — 사용자가 분배 결과를 confirm/override 권장 (codex review).
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// CTO worker 의 Slack 답글 formatter.
// 본문 구조:
//   *📋 CTO 분배 결과* (배정 0건이면 제목에 그 사실을 붙인다)
//   ctoSummary
//
//   *Priority 1 (urgent)*
//   • [BE] taskTitle — reasoning (confidence 0.9)
//   • [BE_SCHEMA] ...
//
//   *Priority 2 / 3 ...*
//
//   *⚠️ 보류 — 담당을 정해주세요*
//   • taskTitle — reason
//
//   _이대로 진행할까요? ... (자연어 승인/재배정 안내)_
export interface FormatAssignmentOptions {
  // 실행 승인 카드(PreviewGate CTO_BE_CHAIN)가 함께 열렸는지. true 면 "응" 안내를 붙인다.
  // 승인 카드 없이 표만 보여주는 경로(분배 0건 등)에서 "응 하세요" 라고 하면 거짓말이 된다.
  //
  // 배정 드롭다운 안내도 이 값에 묶인다. 드롭다운은 승인 카드의 블록에만 붙으므로
  // (assignment-card.builder), 카드 없이 텍스트만 나가는 경로 — autopilot 아침 발송,
  // /retry-run — 에서 "항목 옆 드롭다운" 을 안내하면 사용자는 없는 UI 를 찾게 된다.
  awaitingApproval?: boolean;
}

export const formatAssignmentOutput = (
  output: AssignmentOutput,
  options: FormatAssignmentOptions = {},
): string => {
  const hasAssignments = output.assignments.length > 0;
  // 배정 0건은 제목에서 한 번만 말한다. 예전에는 제목 · 본문 · 보류 사유가 같은 사실을
  // 세 번 반복해, 정보량 한 줄짜리 카드가 네 문단으로 나갔다.
  const lines: string[] = [
    hasAssignments
      ? '*📋 CTO 분배 결과*'
      : '*📋 CTO 분배 결과 — 자동 배정 0건*',
  ];
  if (output.ctoSummary.trim().length > 0) {
    lines.push('');
    lines.push(escapeSlackMrkdwn(output.ctoSummary));
  }

  if (hasAssignments) {
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
  }

  if (output.unassignedTasks.length > 0) {
    lines.push('');
    // "자동 분배 보류 (사용자 결정 필요)" 는 상태만 말하고 무엇을 하라는 건지는 말하지
    // 않았다. 사용자가 실제로 해야 하는 일 — 담당 고르기 — 을 제목에 둔다.
    lines.push('*⚠️ 보류 — 담당을 정해주세요*');
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
    // 배정 변경은 카드의 드롭다운이 정식 경로다. 드롭다운으로 표현되지 않는 요청
    // (우선순위, 보류로 빼기) 은 말로 받아 CTO 를 다시 태운다.
    lines.push(
      '_배정은 항목 옆 드롭다운에서 바꿀 수 있습니다. 우선순위·보류 조정은 말로 알려주세요 — 예: "3번은 빼줘"._',
    );
    return lines.join('\n');
  }

  // 카드 없이 텍스트만 나가는 경로. 실제로 동작하는 입구는 자연어 답장 하나뿐이므로
  // 그것만 안내한다 — 보류만 남은 회차에는 "담당 고르기" 예시로 바꿔 준다.
  lines.push(
    output.unassignedTasks.length > 0
      ? '_담당은 말로 정해주세요 — 예: "PR #52는 BE로", "그건 내가 직접 할게"._'
      : '_바꿀 게 있으면 말로 알려주세요 — 예: "3번은 테스트로"._',
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
