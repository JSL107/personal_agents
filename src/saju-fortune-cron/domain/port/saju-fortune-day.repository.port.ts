export const SAJU_FORTUNE_DAY_REPOSITORY_PORT = Symbol(
  'SAJU_FORTUNE_DAY_REPOSITORY_PORT',
);

export enum MissionResult {
  DONE = 'done',
  NOT_DONE = 'not_done',
}

// 날짜는 모두 KST 'YYYY-MM-DD'. DB 날짜 변환은 저장소 안에서만 한다.
export interface SentFortuneDay {
  slackUserId: string;
  fortuneDate: string;
  missionKey: string;
  missionText: string;
  aiBody: string;
  // 그림이 실제로 붙어 나간 날만 있다.
  card?: { title: string; thumbnail: Buffer };
}

export interface RecentMission {
  missionKey: string;
  fortuneDate: string;
}

export interface MissionDay {
  fortuneDate: string;
  missionText: string;
  missionResult?: MissionResult;
  createdAt: Date;
}

export interface MonthCard {
  fortuneDate: string;
  thumbnail: Buffer;
}

export interface SajuFortuneDayKey {
  slackUserId: string;
  fortuneDate: string;
}

// 사주 운세 하루 기록. 아침 발송이 성공한 뒤 recordSent 로 한 번 쓰고, 저녁 확인·버튼·카드 모음이 읽는다.
export interface SajuFortuneDayRepositoryPort {
  recordSent(day: SentFortuneDay): Promise<void>;
  // before 이전 days 일(before 당일 제외) — 같은 날 재시도가 같은 미션을 고르게. 날짜 내림차순.
  findRecentMissionKeys(input: {
    slackUserId: string;
    before: string;
    days: number;
  }): Promise<RecentMission[]>;
  findMissionDay(input: SajuFortuneDayKey): Promise<MissionDay | undefined>;
  // false = 그날 행이 없다.
  answerMission(
    input: SajuFortuneDayKey & { result: MissionResult },
  ): Promise<boolean>;
  countWeekDone(input: {
    slackUserId: string;
    monday: string;
  }): Promise<number>;
  // month 'YYYY-MM'. 썸네일이 있는 날만 날짜순.
  findMonthCards(input: {
    slackUserId: string;
    month: string;
  }): Promise<MonthCard[]>;
}
