import { parseDueDate } from './parse-due-date';
import { PlainDate } from './schedule.type';

export type ScheduleCommand =
  | { kind: 'REGISTER'; title: string; dueDate: PlainDate }
  | { kind: 'NEEDS_DATE'; title: string }
  | { kind: 'NEEDS_TITLE' };

// 날짜로 쓰인 조각과 "등록해줘" 류 지시어를 제목에서 걷어낸다. 남는 것이 사용자가 부르는 이름이다.
const DATE_FRAGMENTS = [
  /\d{4}-\d{1,2}-\d{1,2}/g,
  /\d{1,2}월\s*\d{1,2}일/g,
  /\d{1,2}월\s*말/g,
  /다음\s*주\s*[일월화수목금토]요일/g,
  /이번\s*주\s*[일월화수목금토]요일/g,
  /오늘|내일|모레/g,
];

// 지시어는 **문장 끝에 올 때만** 걷어낸다. 앵커 없이 잡으면 제목에 든 정상 낱말을 먹는다
// ("주민등록 등본 발급" 의 등록, "자동이체 추가 신청" 의 추가). 종결어미를 필수로 둬야
// 동사 하나만으로는 매칭되지 않는다.
const TRAILING_INSTRUCTION =
  /\s*(일정|스케줄|마감|리마인더)?\s*(등록|추가|잡아|넣어)\s*(해줘|해|줘|주세요)\s*$/;

const stripTitle = (text: string): string => {
  let stripped = text;
  for (const pattern of DATE_FRAGMENTS) {
    stripped = stripped.replace(pattern, ' ');
  }
  stripped = stripped.replace(TRAILING_INSTRUCTION, ' ');
  return stripped.replace(/\s+/g, ' ').trim();
};

export const parseScheduleCommand = (
  text: string,
  today: PlainDate,
): ScheduleCommand => {
  const title = stripTitle(text);
  const dueDate = parseDueDate(text, today);

  if (!title) {
    return { kind: 'NEEDS_TITLE' };
  }
  if (!dueDate) {
    return { kind: 'NEEDS_DATE', title };
  }
  return { kind: 'REGISTER', title, dueDate };
};
