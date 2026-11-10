import { parseArgs } from 'node:util';

import { DayBoundary } from 'manseryeok';

import {
  BirthTime,
  NatalBirthInput,
  natalPillarsOf,
  NatalPillarsResult,
} from '../src/saju-fortune-cron/application/natal-pillars';
import { parseSajuFortuneRecipients } from '../src/saju-fortune-cron/domain/saju-fortune-cron.type';

// 생년월일시 → SAJU_FORTUNE_RECIPIENTS 기둥(과 붙여 넣을 항목 한 줄).
// 과거 표준시·서머타임은 항상 고치고, 진태양시는 --solar-time <경도> 를 줄 때만 고친다.
// 생년월일은 출력·저장하지 않지만 명령 인자는 셸 history 에 남는다.
const USAGE = `사용법: pnpm saju:pillars --date 1990-05-17 [--time 14:30] [--lunar [--leap]]
                          [--solar-time 126.98] [--day-boundary midnight|jasi|splitJasi]
                          [--slack U123 --name 길동 [--send 07:30] [--birthday]]
  --time          출생 시각(그때 시계 그대로). 모르면 생략 → 기둥 3개
  --lunar/--leap  음력 / 음력 윤달
  --solar-time    진태양시 보정을 켜고 출생지 경도를 준다(서울 126.98, 부산 129.08)
  --day-boundary  밤 11시대 출생의 날짜 기준. 기본 midnight(자정에 날짜가 바뀜)
  --slack/--name  주면 SAJU_FORTUNE_RECIPIENTS 에 붙여 넣을 항목을 만든다
  --birthday      항목에 --date 의 월-일을 양력 생일 칸으로 넣는다(생일 특집용, 음력 불가)`;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_BOUNDARIES: readonly DayBoundary[] = [
  'midnight',
  'jasi',
  'splitJasi',
];

const fail = (message: string): never => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
};

const parseTime = (raw: string | undefined): BirthTime | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const matched = TIME_PATTERN.exec(raw) ?? fail(`--time 형식 오류: ${raw}`);
  const [, hour, minute] = matched.map(Number);
  return { hour, minute };
};

const parseLongitude = (raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const longitude = Number(raw);
  if (!Number.isFinite(longitude) || longitude < 120 || longitude > 135) {
    fail(`--solar-time 경도는 한반도 범위(120~135)로 주세요: ${raw}`);
  }
  return longitude;
};

const parseDayBoundary = (raw: string | undefined): DayBoundary | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const dayBoundary =
    DAY_BOUNDARIES.find((boundary) => boundary === raw) ??
    fail(`--day-boundary 는 ${DAY_BOUNDARIES.join('|')} 중 하나: ${raw}`);
  return dayBoundary;
};

// 달력에 없는 날·윤달은 manseryeok 이 RangeError 로 끊는다 — 스택 대신 사용법과 함께 알린다.
// 칸 순서는 슬랙ID|이름|기둥|발송 시각|생일 — 발송 시각 없이 생일만 있으면 넷째 칸을 비워 둔다.
const entryOf = (fields: (string | undefined)[]): string => {
  const joined = fields.map((field) => field ?? '').join('|');
  // 끝의 빈 칸만 걷어 낸다 — 가운데 빈 칸(발송 시각)은 생일 자리를 지키려고 남긴다.
  const trimmed = joined.replace(/\|+$/, '');
  return trimmed;
};

const natalPillarsOrFail = (input: NatalBirthInput): NatalPillarsResult => {
  try {
    return natalPillarsOf(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
};

const main = (): void => {
  const { values } = parseArgs({
    options: {
      date: { type: 'string' },
      time: { type: 'string' },
      lunar: { type: 'boolean', default: false },
      leap: { type: 'boolean', default: false },
      'solar-time': { type: 'string' },
      'day-boundary': { type: 'string' },
      slack: { type: 'string' },
      name: { type: 'string' },
      send: { type: 'string' },
      birthday: { type: 'boolean', default: false },
    },
  });
  const dateMatched =
    DATE_PATTERN.exec(values.date ?? '') ??
    fail('--date YYYY-MM-DD 가 필요합니다.');
  const [, year, month, day] = dateMatched.map(Number);
  if (values.leap && !values.lunar) {
    fail('--leap 은 --lunar 와 함께 씁니다.');
  }
  if (values.birthday && values.lunar) {
    fail('--birthday 는 양력 생일만 받습니다(--lunar 와 함께 쓸 수 없음).');
  }
  if (values.birthday && (!values.slack || !values.name)) {
    fail('--birthday 는 --slack·--name 과 함께 씁니다.');
  }

  const { pillars, warnings } = natalPillarsOrFail({
    year,
    month,
    day,
    time: parseTime(values.time),
    isLunar: values.lunar,
    isLeapMonth: values.leap,
    solarTimeLongitude: parseLongitude(values['solar-time']),
    dayBoundary: parseDayBoundary(values['day-boundary']),
  });

  const pillarText = pillars.join(' ');
  console.log(`기둥: ${pillarText}`);
  warnings.forEach((warning) => console.log(`⚠️  ${warning}`));

  if (!values.slack && !values.name) {
    return;
  }
  const birthday = values.birthday
    ? values.date?.slice('YYYY-'.length)
    : undefined;
  const entry = entryOf([
    values.slack,
    values.name,
    pillarText,
    values.send,
    birthday,
  ]);
  // 붙여 넣을 값이 실제 파서를 통과하는지 확인한다 — 틀린 항목은 운세 cron 에서 조용히 빠진다.
  if (parseSajuFortuneRecipients(entry).recipients.length !== 1) {
    fail(
      `항목 형식 오류: ${entry}\n--slack(U로 시작), --name, --send(HH:MM)를 확인하세요.`,
    );
  }
  console.log(
    `\nSAJU_FORTUNE_RECIPIENTS 항목 (여러 명이면 ; 로 잇는다):\n${entry}`,
  );
};

main();
