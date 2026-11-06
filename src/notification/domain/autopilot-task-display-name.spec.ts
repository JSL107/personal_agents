import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  // 콘솔 앱(Swift)의 reportKindLabel 은 별도 표다. 한쪽만 고치면 같은 작업이 Slack 과 콘솔에서
  // 다른 이름으로 보인다(2026-11-06). 서버 표에 없는 id(콘솔 전용)는 비교하지 않는다.
  it('콘솔 이름표가 서버 이름표와 같다', () => {
    const swift = readFileSync(
      join(
        __dirname,
        '../../../clients/idaeri-console/Sources/ConsoleCore/Deliveries.swift',
      ),
      'utf8',
    );
    const table = swift.slice(
      swift.indexOf('func reportKindLabel'),
      swift.indexOf('return labels[id]'),
    );
    const entries = [...table.matchAll(/"([a-z-]+)": "([^"]+)"/g)];
    expect(entries.length).toBeGreaterThan(0);
    const mismatched = entries
      .map(([, taskId, consoleName]) => ({
        taskId,
        consoleName,
        serverName: toAutopilotTaskDisplayName(`Autopilot task ${taskId}`),
      }))
      .filter(
        ({ taskId, consoleName, serverName }) =>
          serverName !== taskId && serverName !== consoleName,
      );
    expect(mismatched).toEqual([]);
  });
});
