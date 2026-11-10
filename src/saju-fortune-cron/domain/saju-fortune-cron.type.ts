import { isValidPillar } from './day-pillar';

export const SAJU_FORTUNE_CRON_QUEUE = 'saju-fortune-cron';

// 사주는 잡 데이터에 싣지 않는다 — Redis 에 남지 않게 consumer 가 매 회차 env 에서 읽는다.
// 잡은 발송 시각별로 하나씩 등록되고, 그 시각에 받을 사람의 Slack ID 만 싣는다.
export interface SajuFortuneCronJobData {
  recipientSlackUserIds: string[];
}

// 매일 08:00 KST 기본.
export const DEFAULT_SAJU_FORTUNE_CRON = '0 8 * * *';
// 시간대는 설정으로 열지 않는다 — consumer 의 "오늘"(일진·발송 가드)이 KST 고정이라,
// cron 만 다른 시간대로 돌면 날짜 경계에서 엉뚱한 날의 일진이 나간다.
export const SAJU_FORTUNE_TIMEZONE = 'Asia/Seoul';

export interface SajuFortuneRecipient {
  slackUserId: string;
  name: string;
  // 만세력에서 확인한 타고난 기둥 — 년·월·일(·시) 순. 시각을 모르면 3개.
  natalPillars: string[];
  // 'HH:MM' KST. 없으면 SAJU_FORTUNE_CRON 을 따른다.
  sendTime?: string;
  // 양력 'MM-DD'. LLM 에는 날짜로 싣지 않고 "오늘이 생일" 사실만 싣는다.
  birthday?: string;
}

export interface ParsedSajuFortuneRecipients {
  recipients: SajuFortuneRecipient[];
  // 형식이 틀린 항목. 사주 원문을 로그에 남기지 않도록 몇 번째 항목인지만 담는다.
  invalidEntryNumbers: number[];
}

const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]+$/;
const MINIMUM_PILLAR_COUNT = 3;
const MAXIMUM_PILLAR_COUNT = 4;
// 슬랙ID|이름|기둥 은 필수, 발송 시각·생일은 선택.
const MINIMUM_FIELD_COUNT = 3;
const MAXIMUM_FIELD_COUNT = 5;
const SEND_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const BIRTHDAY_PATTERN = /^(\d{2})-(\d{2})$/;
// 02-29 를 받으려고 윤년 하나로 달력을 검사한다.
const LEAP_YEAR = 2000;

// 'MM-DD' 이고 달력에 있는 날(02-29 포함)인가.
export const isValidBirthday = (text: string): boolean => {
  const matched = BIRTHDAY_PATTERN.exec(text);
  if (!matched) {
    return false;
  }
  const [, month, day] = matched.map(Number);
  const date = new Date(Date.UTC(LEAP_YEAR, month - 1, day));
  const isSameDate =
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isSameDate;
};

// 형식: `U123|길동|丙寅 辛卯 壬戌 庚子|07:30|05-17;U456|철수|...` — 항목은 `;`, 칸은 `|`, 기둥은 공백으로 나눈다.
// 발송 시각·양력 생일 칸은 생략할 수 있다(생일만 넣으려면 `…|기둥||05-17`).
// 생년월일 대신 기둥을 받는 것은 의도다: 매일 LLM 에 실려 가는 값에서 생년월일 자체를 빼기 위해서다.
export const parseSajuFortuneRecipients = (
  raw: string | undefined,
): ParsedSajuFortuneRecipients => {
  const recipients: SajuFortuneRecipient[] = [];
  const invalidEntryNumbers: number[] = [];
  const entries = (raw ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  entries.forEach((entry, index) => {
    const recipient = parseEntry(entry);
    if (recipient) {
      recipients.push(recipient);
    } else {
      invalidEntryNumbers.push(index + 1);
    }
  });
  return { recipients, invalidEntryNumbers };
};

const parseEntry = (entry: string): SajuFortuneRecipient | null => {
  const fields = entry.split('|').map((field) => field.trim());
  const hasValidFieldCount =
    fields.length >= MINIMUM_FIELD_COUNT &&
    fields.length <= MAXIMUM_FIELD_COUNT;
  if (!hasValidFieldCount) {
    return null;
  }
  const [slackUserId, name, pillarText, sendTimeField, birthdayField] = fields;
  // `…|癸亥|` 처럼 칸만 있고 비어 있으면 생략으로 본다.
  const sendTime = sendTimeField || undefined;
  const birthday = birthdayField || undefined;
  const natalPillars = pillarText.split(/\s+/).filter((p) => p.length > 0);
  const hasValidPerson =
    SLACK_USER_ID_PATTERN.test(slackUserId) && name.length > 0;
  const hasValidPillars =
    natalPillars.length >= MINIMUM_PILLAR_COUNT &&
    natalPillars.length <= MAXIMUM_PILLAR_COUNT &&
    natalPillars.every(isValidPillar);
  const hasValidSendTime =
    sendTime === undefined || SEND_TIME_PATTERN.test(sendTime);
  const hasValidBirthday = birthday === undefined || isValidBirthday(birthday);
  const isValid =
    hasValidPerson && hasValidPillars && hasValidSendTime && hasValidBirthday;
  if (!isValid) {
    return null;
  }
  const recipient: SajuFortuneRecipient = {
    slackUserId,
    name,
    natalPillars,
    ...(sendTime === undefined ? {} : { sendTime }),
    ...(birthday === undefined ? {} : { birthday }),
  };
  return recipient;
};

// 'HH:MM' → 매일 그 시각 cron. 형식은 파서가 이미 검사했다.
export const dailyCronOf = (sendTime: string): string => {
  const [hour, minute] = sendTime.split(':').map(Number);
  return `${minute} ${hour} * * *`;
};
