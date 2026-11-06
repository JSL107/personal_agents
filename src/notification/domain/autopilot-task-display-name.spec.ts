import { AUTOPILOT_PLAYBOOK } from '../../autopilot/domain/autopilot.playbook';
import {
  toAutopilotTaskDisplayName,
  toIncidentLabel,
  toResolvedLabel,
} from './autopilot-task-display-name';

describe('autopilot task 이름표', () => {
  it('cron 이름을 이름표 + 실패로 바꾸고, 해결 줄에서는 실패를 뗀다', () => {
    expect(toIncidentLabel('Autopilot task preview-sweeper')).toBe(
      '만료 승인 카드 정리 실패',
    );
    expect(toResolvedLabel('Autopilot task preview-sweeper')).toBe(
      '만료 승인 카드 정리',
    );
  });

  it('id 만 남은 원장 label 도 이름표로 바꾼다', () => {
    expect(toIncidentLabel('instagram-token-check')).toBe(
      '인스타그램 토큰 점검 실패',
    );
  });

  it('이름표 label 에도 실패를 붙이되 두 번 붙이지 않는다', () => {
    expect(toIncidentLabel('Hermes 아침신문')).toBe('Hermes 아침신문 실패');
    expect(toIncidentLabel('모의투자 추천 실패')).toBe('모의투자 추천 실패');
    expect(toResolvedLabel('Hermes 아침신문')).toBe('Hermes 아침신문');
  });

  // 표에 없는 task 는 영어 id 가 그대로 메시지에 나간다(2026-11-05 저녁 「preview-sweeper」).
  it('플레이북의 모든 task 에 이름표가 있다', () => {
    const missing = [
      ...new Set(AUTOPILOT_PLAYBOOK.map((entry) => entry.taskId)),
    ].filter(
      (taskId) =>
        toAutopilotTaskDisplayName(`Autopilot task ${taskId}`) === taskId,
    );
    expect(missing).toEqual([]);
  });
});
