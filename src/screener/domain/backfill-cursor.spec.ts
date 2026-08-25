import {
  buildBackfillCursor,
  calculateBackfillStartDate,
} from './backfill-cursor';

describe('buildBackfillCursor', () => {
  it('거래일을 토스가 받는 KST 자정 ISO 8601 커서로 조립한다', () => {
    expect(buildBackfillCursor(new Date('2025-10-21T00:00:00.000Z'))).toBe(
      '2025-10-21T00:00:00.000+09:00',
    );
  });
});

describe('calculateBackfillStartDate', () => {
  it('오늘에서 연수만큼 뺀 날짜를 낸다', () => {
    expect(calculateBackfillStartDate('2026-08-25', 5)).toBe('2021-08-25');
  });

  // Date 로 계산하면 2023-02-29 가 없어 2023-03-01 로 굴러가고, 목표가 하루 늦어진
  // 만큼 과거를 덜 받는다. 문자열로 다루면 비교 기준이 그대로 유지된다.
  it('윤년 2월 29일에도 목표일이 다음 달로 굴러가지 않는다', () => {
    expect(calculateBackfillStartDate('2028-02-29', 5)).toBe('2023-02-29');
  });
});
