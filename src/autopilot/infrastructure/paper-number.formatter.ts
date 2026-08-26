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
