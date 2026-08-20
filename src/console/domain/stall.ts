import { ConsoleAgentAutonomy } from './ledger.type';

export interface StallThresholdInput {
  readonly activeDays: number;
  readonly spanDays: number;
}

export interface StallInput extends StallThresholdInput {
  readonly autonomy: ConsoleAgentAutonomy;
  readonly idleDays: number;
}

/**
 * 매일 도는 워커는 3일 중단도 고장이지만 주간 워커는 10일 공백도 정상이라 고정 임계값을
 * 쓸 수 없다. 표본 3일 미만은 간격 표본이 하나 이하여서 주기를 추정할 수 없으므로 7일을
 * 안전 기준으로 둔다. 실행 건수가 아니라 distinct KST 날짜를 쓰는 이유는 한 슬롯의 연속
 * 실행이 평균을 분 단위로 낮춰 임계값을 무의미하게 만들기 때문이다.
 *
 * 오늘까지의 ageDays를 쓰면 유휴 기간이 임계값에 섞여 멈출수록 기준도 관대해진다. 특히
 * activeDays가 3이면 임계값이 ageDays와 같고 idleDays는 이를 넘을 수 없어 영구 정지도
 * 판정하지 못한다. 그래서 첫 자율 실행부터 마지막 자율 실행까지의 spanDays만 쓴다.
 * 활동일 N개에서 관측된 것은 실행 N회가 아니라 그 사이 N-1개 간격이므로 분모도
 * activeDays - 1이다.
 *
 * 실데이터 검산(activeDays/spanDays/idleDays): OPS_SUPERVISOR(1/0/19)는 정지,
 * CEO(13/48/4)는 주기 4.0일·임계 12일로 정상, IMPACT_REPORTER(8/47/5),
 * CODE_REVIEWER(18/20/0), PM(54/58/0)도 정상이다.
 */
export const calculateStallThresholdDays = (
  input: StallThresholdInput,
): number => {
  if (input.activeDays < 3) {
    return 7;
  }

  const intervalCount = input.activeDays - 1;
  return Math.max((input.spanDays / intervalCount) * 3, 7);
};

export const isStalled = (input: StallInput): boolean => {
  if (input.autonomy !== 'AUTONOMOUS') {
    return false;
  }

  const thresholdDays = calculateStallThresholdDays(input);
  return input.idleDays > thresholdDays;
};
