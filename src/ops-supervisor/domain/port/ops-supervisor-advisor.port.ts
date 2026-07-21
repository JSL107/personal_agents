export const OPS_SUPERVISOR_ADVISOR_PORT = Symbol(
  'OPS_SUPERVISOR_ADVISOR_PORT',
);

// 이상 신호 요약을 받아 개선 방향을 제안한다. 자동 반영하지 않는다.
export interface OpsSupervisorAdvisorPort {
  advise(input: { anomaliesSummary: string }): Promise<string>;
}
