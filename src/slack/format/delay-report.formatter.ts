import { DelayVerdict } from '../../agent/delay-report/domain/delay-report.type';

const primaryAction = (cause: DelayVerdict['primaryCause']): string => {
  switch (cause) {
    case 'APPROVAL_WAIT':
      return 'Slack 카드에서 승인/거절만 눌러주시면 바로 진행됩니다.';
    case 'RUN_IN_PROGRESS':
      return '30분 안쪽은 정상 범위라 완료될 때까지 지켜보면 됩니다.';
    case 'UNRESOLVED_FAILURE':
      return '실패 원인에 맞는 연동·쿼터를 해결한 뒤 `/retry-run` 으로 재실행할 수 있어요.';
    case 'NONE':
      return '현재 확인할 조치는 없습니다.';
  }
};

export const formatDelayReport = (verdict: DelayVerdict): string => {
  if (verdict.primaryCause === 'NONE') {
    const notes = verdict.secondaryNotes.slice(0, 3);
    const noteText =
      notes.length > 0
        ? `\n\n그 밖에\n${notes.map((note) => `• ${note}`).join('\n')}`
        : '';
    if (verdict.unavailableAxes.length > 0) {
      return `확인하지 못했어요: ${verdict.unavailableAxes.join(', ')}. 그래서 지연 없다고 단정할 수 없어요.${noteText}`;
    }
    return `지연 없습니다. 승인 대기도, 진행 중 작업도, 미해소 실패도 없어요.${noteText}`;
  }

  const notes = verdict.secondaryNotes.slice(0, 3);
  const secondaryText =
    notes.length > 0
      ? `\n\n그 밖에\n${notes.map((note) => `• ${note}`).join('\n')}`
      : '';
  const unavailableText =
    verdict.unavailableAxes.length > 0
      ? ` 다만 ${verdict.unavailableAxes.join(', ')}는 확인하지 못했어요.`
      : '';
  return `${verdict.detail} ${primaryAction(verdict.primaryCause)}${unavailableText}${secondaryText}`;
};
