import { ConsoleAgentAutonomy } from './ledger.type';

export interface StallThresholdInput {
  readonly activeDays: number;
  readonly ageDays: number;
}

export interface StallInput extends StallThresholdInput {
  readonly autonomy: ConsoleAgentAutonomy;
  readonly idleDays: number;
}

/**
 * 매일 도는 워커는 3일 중단도 고장이지만 주간 워커는 10일 공백도 정상이라 고정 임계값을
 * 쓸 수 없다. 표본 3일 미만은 주기를 추정할 수 없어 7일을 안전 기준으로 둔다. 실행 건수가
 * 아니라 distinct KST 날짜를 쓰는 이유는 한 슬롯의 연속 실행이 평균을 분 단위로 낮춰
 * 임계값을 무의미하게 만들기 때문이다.
 *
 * 실데이터 검산: OPS_SUPERVISOR(1/19/19)는 정지, CEO(13/52/4)는 주기 4.0일·임계
 * 12일로 정상, PM(54/59/1)은 정상이다. 순서는 activeDays/ageDays/idleDays다.
 */
export const calculateStallThresholdDays = (
  input: StallThresholdInput,
): number => {
  if (input.activeDays < 3) {
    return 7;
  }

  return Math.max((input.ageDays / input.activeDays) * 3, 7);
};

export const isStalled = (input: StallInput): boolean => {
  if (input.autonomy !== 'AUTONOMOUS') {
    return false;
  }

  const thresholdDays = calculateStallThresholdDays(input);
  return input.idleDays > thresholdDays;
};
