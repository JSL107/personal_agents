// 아침 한 통(morning-briefing)이 다른 task 의 결과를 원장에서 읽어 한 줄씩 만드는 조회 포트.
// 원래 task 들은 Slack 요약을 내지 않고 원장(slack_delivery·study_brief 등)에만 남기므로,
// 아침 메시지가 그 결과를 되읽는 유일한 자리다.

export interface OpenIncidentRow {
  label: string;
  openedAt: Date;
}

export interface DuePaperOrderCount {
  buyCount: number;
  sellCount: number;
}

export interface MorningDigestRepositoryPort {
  // 아직 닫히지 않은 사건. `seenSince` 이후 다시 실패한 것만 — 해결 신호가 영영 오지 않는
  // 사건(폐지된 task 등)이 매일 아침 "N일째" 로 남는 것을 막는다.
  findOpenIncidents(input: { seenSince: Date }): Promise<OpenIncidentRow[]>;
  // 그 시각 이후 만든 가장 최근 공부 브리프.
  findLatestStudyBrief(input: {
    ownerUserId: string;
    since: Date;
  }): Promise<{ topic: string; notionUrl: string | null } | null>;
  // 콘솔 경로로 원장에만 남은 그 task 의 가장 최근 전문.
  findLatestConsoleText(input: {
    itemKind: string;
    since: Date;
  }): Promise<string | null>;
  // 그 거래일(또는 그 전)에 체결할 대기 주문 수.
  countDuePaperOrders(input: { tradeDate: Date }): Promise<DuePaperOrderCount>;
}

export const MORNING_DIGEST_REPOSITORY_PORT = Symbol(
  'MORNING_DIGEST_REPOSITORY_PORT',
);
