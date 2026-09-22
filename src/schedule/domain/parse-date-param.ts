import { BadRequestException } from '@nestjs/common';

import { plainDateToUtcDate } from './parse-due-date';
import { PlainDate } from './schedule.type';

export const parseDateParam = (value: string, label: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} 는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  // new Date('2026-02-31') 은 Invalid 가 아니라 3월 3일로 굴러간다. 되돌려 찍어 원문과
  // 다르면 달력에 없는 날짜다 — 조용히 다음 달을 긁어오는 것을 여기서 끊는다.
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(
      `${label} 에 달력에 없는 날짜가 들어왔습니다.`,
    );
  }
  return parsed;
};

// 등록(POST)이 받는 날짜. 조회 범위와 달리 저장으로 이어지므로 `PlainDate` 로 넘긴다 —
// `Date` 로 들고 다니면 저장 직전에 로컬 타임존이 끼어 하루가 밀린다(`parse-due-date.ts` 의
// `plainDateToUtcDate` 가 같은 이유로 UTC 자정만 만든다).
//
// **`parseDateParam` 을 통과한 것만으로는 부족하다.** 그 검사는 `new Date(value)` 의 ISO
// 파싱을 보는데, 저장은 `Date.UTC` 를 쓰는 `plainDateToUtcDate` 를 지난다. 둘은 0~99 년에서
// 갈린다 — `new Date('0099-09-30')` 은 0099 년이지만 `Date.UTC(99, 8, 30)` 은 1999 년이라
// (실측), 통과시킨 날짜가 저장 직전에 1900 년을 더해 다른 해로 앉는다. Slack 경로는
// `parseDueDate` 의 `isRealDate` 가 같은 대조를 해서 막고 있었고, 이 입구만 열려 있었다.
//
// 그래서 **저장이 실제로 쓰는 함수로 되돌려 찍어 대조한다**. 다른 검사를 하나 더 만들면
// 그 둘이 갈리는 날이 오고, 갈린 쪽이 어디인지는 저장된 값으로만 알 수 있다.
export const parsePlainDateParam = (
  value: string,
  label: string,
): PlainDate => {
  const parsed = parseDateParam(value, label);
  const plain: PlainDate = {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
  if (plainDateToUtcDate(plain).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(
      `${label} 에 저장할 수 없는 날짜가 들어왔습니다.`,
    );
  }
  return plain;
};
