import { DatePeriod } from '../saju-fortune-period';

export const SAJU_FORTUNE_DAY_REPOSITORY_PORT = Symbol(
  'SAJU_FORTUNE_DAY_REPOSITORY_PORT',
);

export enum MissionResult {
  DONE = 'done',
  NOT_DONE = 'not_done',
}

// 날짜는 모두 KST 'YYYY-MM-DD'. DB 날짜 변환은 저장소 안에서만 한다.
export interface SajuFortuneDayKey {
  slackUserId: string;
  fortuneDate: string;
}

export interface SentCard {
  title: string;
  thumbnail: Buffer;
}

export interface SentFortuneDay extends SajuFortuneDayKey {
  missionKey: string;
  missionText: string;
  aiBody: string;
  // 그림이 실제로 붙어 나간 날만 있다.
  card?: SentCard;
}

export interface MissionAnswer extends SajuFortuneDayKey {
  result: MissionResult;
}

// 기간을 정하는 규칙은 domain(saju-fortune-period)에 있다 — 저장소는 받은 기간을 조회만 한다.
export interface PeriodQuery {
  slackUserId: string;
  period: DatePeriod;
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

export interface CollectedCard {
  fortuneDate: string;
  thumbnail: Buffer;
}

// 사주 운세 하루 기록. 아침 발송이 성공한 뒤 recordSent 로 한 번 쓰고, 저녁 확인·버튼·카드 모음이 읽는다.
export interface SajuFortuneDayRepositoryPort {
  recordSent(day: SentFortuneDay): Promise<void>;
  // 날짜 내림차순.
  findMissionKeys(query: PeriodQuery): Promise<RecentMission[]>;
  findMissionDay(key: SajuFortuneDayKey): Promise<MissionDay | undefined>;
  // false = 그날 행이 없다.
  answerMission(answer: MissionAnswer): Promise<boolean>;
  countDone(query: PeriodQuery): Promise<number>;
  // 썸네일이 있는 날만 날짜순.
  findCards(query: PeriodQuery): Promise<CollectedCard[]>;
}
