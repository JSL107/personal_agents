import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const toKoreanDate = (date: Date): string => {
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
};

// 제목은 사용자가 친 원문이다. 두 가지를 같이 처리한다.
// 1) `escapeSlackMrkdwn` 으로 `&`·`<`·`>` 를 막는다 — 안 하면 Slack 이 `<...>` 를 링크 태그로
//    읽어 텍스트가 잘리거나 사라진다(렌더 위조).
// 2) 굵게 표시는 **우리가 쓴 리터럴에만** 건다. 사용자 문자열을 `*...*` 로 감싸면 제목에 든
//    `*` 하나로 비대칭이 생겨 그 줄 전체 렌더가 깨진다. escape 는 `*` 를 다루지 않는다.
export const formatScheduleRegistered = (
  record: ScheduleItemRecord,
): string => {
  const title = escapeSlackMrkdwn(record.title);
  return `*등록했습니다* — ${title} · ${toKoreanDate(record.dueDate)}`;
};

export const formatNeedsDate = (title: string): string => {
  return `${escapeSlackMrkdwn(title)} — *언제까지인가요?* (예: 9월 30일, 내일, 다음주 월요일)`;
};

export const formatNeedsTitle = (): string => {
  return '무엇을 등록할까요? 날짜와 이름을 같이 적어주세요 (예: 9월 30일 자동차세).';
};
