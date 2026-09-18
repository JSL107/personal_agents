import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';

const toKoreanDate = (date: Date): string => {
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
};

export const formatScheduleRegistered = (
  record: ScheduleItemRecord,
): string => {
  return `등록했습니다 — *${record.title}* · ${toKoreanDate(record.dueDate)}`;
};

export const formatNeedsDate = (title: string): string => {
  return `*${title}* 언제까지인가요? (예: 9월 30일, 내일, 다음주 월요일)`;
};

export const formatNeedsTitle = (): string => {
  return '무엇을 등록할까요? 날짜와 이름을 같이 적어주세요 (예: 9월 30일 자동차세).';
};
