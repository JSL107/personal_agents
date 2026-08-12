export const MARKET_CLOSE_GUARD_KST = '15:40';

// 국내 정규장 종가는 KST 15:30에 확정된다. 그 전에 받은 오늘 봉을 저장하면
// 주가 감시가 저장된 마지막 날짜만 보고 휴장으로 오판하므로 저장 자체를 막는다.
export const isIntradayCapture = (tradeDate: Date, now: Date): boolean => {
  const kstParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    return kstParts.find((candidate) => candidate.type === type)?.value ?? '';
  };
  const kstDate = `${part('year')}-${part('month')}-${part('day')}`;
  const utcTradeDate = [
    tradeDate.getUTCFullYear(),
    String(tradeDate.getUTCMonth() + 1).padStart(2, '0'),
    String(tradeDate.getUTCDate()).padStart(2, '0'),
  ].join('-');

  if (kstDate !== utcTradeDate) {
    return false;
  }

  return `${part('hour')}:${part('minute')}` < MARKET_CLOSE_GUARD_KST;
};
