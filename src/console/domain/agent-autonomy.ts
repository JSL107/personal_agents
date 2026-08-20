import { ConsoleAgentAutonomy } from './ledger.type';

/**
 * 무실행을 한 덩어리로 보면 정상적인 수동 워커 8종에 고장 낙인이 찍히고, 실제로 멈춘
 * 자율 워커 1종은 그 안에 묻혔다. 자율 워커만 “안 도는 것”이 고장이므로 실행 계기를
 * 분류한다. `autopilot.playbook.ts`는 `taskId`만 갖고 `AgentType` 참조가 없어 읽지 않는다.
 * `ops-supervisor`와 `OPS_SUPERVISOR` 같은 이름 대응은 생산자 규칙이 바뀌면 조회 성공과
 * 빈 결과가 함께 생기는 우연한 결합이다.
 */
export const classifyAutonomy = (
  triggerTypes: readonly string[],
): ConsoleAgentAutonomy => {
  if (triggerTypes.length === 0) {
    return 'NEVER_RUN';
  }

  const hasAutonomousTrigger = triggerTypes.some(
    (triggerType) =>
      triggerType.endsWith('_CRON') ||
      triggerType === 'SCHEDULED' ||
      triggerType.endsWith('_SWEEP') ||
      triggerType.endsWith('_TICK'),
  );
  // CODE_REVIEWER는 자율 스윕과 수동 멘션을 함께 받는다. 스윕 중단은 고장이므로 자율을
  // 최우선으로 두어 수동 이력이 고장 판정을 가리지 않게 한다.
  if (hasAutonomousTrigger) {
    return 'AUTONOMOUS';
  }

  if (triggerTypes.every((triggerType) => triggerType.startsWith('WEBHOOK_'))) {
    return 'EVENT_DRIVEN';
  }

  // REPORT_HUMANIZE처럼 다른 워커가 파생 호출하는 미분류 트리거가 있다. 모르는 계기를
  // 정지 대상에서 빼는 쪽이 거짓 경고보다 안전하므로 ON_DEMAND로 접는다.
  return 'ON_DEMAND';
};
