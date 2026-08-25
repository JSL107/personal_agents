export const buildBackfillCursor = (tradeDate: Date): string => {
  const date = tradeDate.toISOString().slice(0, 10);
  return `${date}T00:00:00.000+09:00`;
};

// 저장된 거래일과의 문자열 비교에만 쓰이므로 Date 를 거치지 않는다. `setUTCFullYear` 로
// 연을 빼면 윤년 2월 29일에 존재하지 않는 날짜가 되어 다음 달로 굴러가고(2028-02-29 에서
// 5년 → 2023-03-01), 목표 시작일이 하루 늦어진 만큼 과거를 덜 받는다.
export const calculateBackfillStartDate = (
  today: string,
  years: number,
): string => `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
