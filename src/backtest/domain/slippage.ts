import { TradeSide } from '../../paper-trading/domain/paper-account.type';

/**
 * 재생의 체결가를 한 방향으로 불리하게 민다 — 매수는 비싸게, 매도는 싸게.
 *
 * **슬리피지를 흉내 내는 모델이 아니다.** 자체 슬리피지 모델링을 하지 않기로 한 이유
 * (흉내가 맞는지 검증할 수단이 없다)는 그대로 살아 있다. 이 손잡이가 답하는 질문은
 * "슬리피지가 얼마인가" 가 아니라 **"체결가가 얼마나 불리해지면 이 결론이 무너지나"** 다.
 * 그래서 기본값은 0(미반영)이고, 값을 준 회차는 운영 재현이 아니라 민감도 측정이다.
 *
 * 왕복 한 번에 2배로 물린다(매수 +x%, 매도 −x%). 이 함수는 **가격만** 민다 — 수수료와
 * 거래세는 `calculateTradeCost` 가 체결가에 물려 이미 회전 수에 비례하므로, 여기서 다시
 * 세면 같은 비용을 두 번 물리게 된다.
 */
export const applySlippage = (
  price: number,
  side: TradeSide,
  slippagePercent: number,
): number =>
  side === 'BUY'
    ? price * (1 + slippagePercent / 100)
    : price * (1 - slippagePercent / 100);
