import { parseDueDate } from './parse-due-date';
import { PlainDate } from './schedule.type';

export type ScheduleCommand =
  | { kind: 'REGISTER'; title: string; dueDate: PlainDate }
  | { kind: 'NEEDS_DATE'; title: string }
  // 되묻기 후속으로 날짜만 온 발화("9월 30일")도 여기에 온다. 그 날짜를 버리지 않고 실어
  // 보내야 직전 턴의 제목과 합칠 수 있다.
  | { kind: 'NEEDS_TITLE'; dueDate?: PlainDate };

// 날짜로 쓰인 조각을 제목에서 걷어낸다. 남는 것이 사용자가 부르는 이름이다.
const DATE_CORES = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  '\\d{1,2}월\\s*\\d{1,2}일',
  '\\d{1,2}월\\s*말',
  '다음\\s*주\\s*[일월화수목금토]요일',
  '이번\\s*주\\s*[일월화수목금토]요일',
  '오늘|내일|모레',
];

// 날짜에 붙은 조사는 날짜 표현의 일부로 함께 걷어낸다. 안 걷으면 대표 사용법인
// "자동차세 납부 9월 30일까지" 가 "자동차세 납부 까지" 로 영구 저장된다.
// **날짜 조각 바로 뒤에서만** 지우므로 제목에 든 "납부까지 끝내기" 의 까지는 남는다.
const DATE_PARTICLE = '(?:\\s*(?:전까지|까지|부터|안에|전에|에)(?:는|도)?)?';

const DATE_FRAGMENTS = DATE_CORES.map(
  (core) => new RegExp(`(?:${core})${DATE_PARTICLE}`, 'g'),
);

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

const titleOf = (command: ScheduleCommand): string | undefined =>
  command.kind === 'NEEDS_TITLE' ? undefined : command.title;

const dueDateOf = (command: ScheduleCommand): PlainDate | undefined =>
  command.kind === 'NEEDS_DATE' ? undefined : command.dueDate;

/**
 * 되묻기 후속 발화는 빠진 쪽만 담고 온다("9월 30일"). 직전 턴의 조각과 합쳐야 등록이 끝난다 —
 * 합치지 않으면 제목과 날짜를 번갈아 되물으며 대화가 영원히 끝나지 않는다.
 *
 * 이번 발화를 우선한다. 사용자가 방금 정정했다면 그쪽이 최신 의도다.
 */
export const mergeScheduleCommands = (
  prior: ScheduleCommand,
  next: ScheduleCommand,
): ScheduleCommand => {
  const title = titleOf(next) ?? titleOf(prior);
  const dueDate = dueDateOf(next) ?? dueDateOf(prior);

  if (title && dueDate) {
    return { kind: 'REGISTER', title, dueDate };
  }
  if (title) {
    return { kind: 'NEEDS_DATE', title };
  }
  return { kind: 'NEEDS_TITLE', dueDate };
};

export const parseScheduleCommand = (
  text: string,
  today: PlainDate,
): ScheduleCommand => {
  const title = stripTitle(text);
  const dueDate = parseDueDate(text, today);

  if (!title) {
    return { kind: 'NEEDS_TITLE', dueDate: dueDate ?? undefined };
  }
  if (!dueDate) {
    return { kind: 'NEEDS_DATE', title };
  }
  return { kind: 'REGISTER', title, dueDate };
};
