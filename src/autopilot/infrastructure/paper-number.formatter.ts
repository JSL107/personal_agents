// 모의투자 카드가 숫자를 적는 법. 체결·장중 손절·추천 세 태스크가 같은 표기를 쓰므로 한 자리에
// 둔다 — 표기가 갈리면 같은 금액이 카드마다 다르게 읽힌다.
//
// 감시 알림(`stock-monitor.formatter.ts`) 에도 비슷한 함수가 있으나 접미사가 "만원" 이라 여기
// 함수와 출력이 다르다. 겉모습이 비슷하다고 합치면 그 카드의 문구가 바뀐다 — 별개로 둔다.

export const formatQuantity = (quantity: string): string =>
  Number(quantity).toLocaleString('ko-KR');

export const formatWon = (price: string): string =>
  `${Math.round(Number(price)).toLocaleString('ko-KR')}원`;

export const formatMoney = (amount: number): string => {
  if (Math.abs(amount) < 10_000) {
    return `${Math.round(amount).toLocaleString('ko-KR')}원`;
  }
  return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
};

// 카드가 "언제" 를 안 적으면 Slack 이 찍은 발송 시각이 체결 시점으로 읽힌다. 실제로는 셋이
// 다 다르다 — 추천은 전날 저녁, 체결은 그날 시가(발송보다 30분 앞), 손절은 발송 직전 현재가다.
const KST_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const formatTradeDay = (tradeDate: string): string => {
  const day = new Date(`${tradeDate}T00:00:00.000Z`);
  return (
    `${day.getUTCMonth() + 1}/${day.getUTCDate()}` +
    `(${KST_WEEKDAYS[day.getUTCDay()]})`
  );
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatKstTime = (minutes: number): string =>
  `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
