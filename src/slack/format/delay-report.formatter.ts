import { DelayVerdict } from '../../agent/delay-report/domain/delay-report.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const MAX_NOTES = 3;

// `/retry-run` 은 id 가 필수이고(`retry-run.handler.ts:103`) 워커에 따라 재실행 자체를 거절한다
// (VACATION·PO_SHADOW 등은 명시 거절, switch 에 없는 타입은 default 로 거절). 그래서 id 를 아는
// 경우에만 명령을 안내하고, 재실행 가능 여부는 단정하지 않는다.
const retryHint = (retryRunId: number | null | undefined): string => {
  if (typeof retryRunId !== 'number') {
    return '';
  }
  return ` 그 다음 \`/retry-run ${retryRunId}\` 로 다시 돌려볼 수 있어요(재실행을 지원하지 않는 워커면 그 자리에서 안내가 옵니다).`;
};

// 실패 조치는 유형별로 다르다 — 일반 실패에 "연동·쿼터를 해결하라" 고 하면 실패 원인과 무관한
// 조치를 시키는 셈이 된다.
const failureAction = (verdict: DelayVerdict): string => {
  const retry = retryHint(verdict.retryRunId);
  switch (verdict.failureKind) {
    case 'INTEGRATION':
      return `\`.env\` 에 해당 키를 설정하면 풀립니다.${retry}`;
    case 'QUOTA':
      return `한도가 리셋되면 자동으로 다시 쓸 수 있습니다.${retry}`;
    default:
      return retry.length > 0
        ? `위 사유를 보고 조치한 뒤${retry}`
        : '위 사유를 보고 조치한 뒤 다시 시도해주세요.';
  }
};

const primaryAction = (verdict: DelayVerdict): string => {
  switch (verdict.primaryCause) {
    case 'APPROVAL_WAIT':
      return 'Slack 카드에서 승인/거절만 눌러주시면 바로 진행됩니다.';
    case 'RUN_IN_PROGRESS':
      return '30분 안쪽은 정상 범위라 완료될 때까지 지켜보면 됩니다.';
    case 'UNRESOLVED_FAILURE':
      return failureAction(verdict);
    case 'NONE':
      return '현재 확인할 조치는 없습니다.';
  }
};

const noteBlock = (notes: string[]): string => {
  const shown = notes.slice(0, MAX_NOTES);
  if (shown.length === 0) {
    return '';
  }
  const lines = shown.map((note) => `• ${escapeSlackMrkdwn(note)}`).join('\n');
  return `\n\n그 밖에\n${lines}`;
};

// 결론을 얼마나 세게 말할 수 있는지 — 못 읽은 축이나 멈춤 의심이 있으면 단정하지 않는다.
const caveat = (verdict: DelayVerdict): string => {
  const unverified = verdict.unverifiedHigherPriority;
  if (unverified.length > 0) {
    return ` 다만 더 앞선 원인인 ${unverified.join(', ')}을(를) 확인하지 못해, 이게 첫 원인이라고 단정하기는 어려워요.`;
  }
  if (verdict.unavailableAxes.length > 0) {
    return ` 다만 ${verdict.unavailableAxes.join(', ')}은(는) 확인하지 못했어요.`;
  }
  return '';
};

const closeWhenNoCause = (verdict: DelayVerdict): string => {
  if (verdict.unavailableAxes.length > 0) {
    return `확인하지 못했어요: ${verdict.unavailableAxes.join(', ')}. 그래서 지연 없다고 단정할 수 없어요.`;
  }
  // 멈춤 의심 run 이 있으면 "지연 없음" 이 아래 메모와 정면으로 어긋난다.
  if (verdict.inconclusiveNotes.length > 0) {
    return '눈에 띄는 승인 대기나 미해소 실패는 없어요. 다만 멈춘 것으로 의심되는 작업이 있어 지연 없다고 잘라 말하긴 어렵습니다.';
  }
  return '지연 없습니다. 승인 대기도, 진행 중 작업도, 미해소 실패도 없어요.';
};

export const formatDelayReport = (verdict: DelayVerdict): string => {
  if (verdict.primaryCause === 'NONE') {
    return `${closeWhenNoCause(verdict)}${noteBlock(verdict.secondaryNotes)}`;
  }
  // detail 에는 원장에 저장된 실패 사유·사용자 카드 제목이 그대로 실린다 — mrkdwn 제어문자를
  // 살려 두면 문장이 깨지므로 내보내기 직전에 escape 한다(secretariat.formatter 와 같은 처리).
  return `${escapeSlackMrkdwn(verdict.detail)} ${primaryAction(verdict)}${caveat(verdict)}${noteBlock(verdict.secondaryNotes)}`;
};
