// 실행을 다시 하라는 명시 동사. "다시" 만 보면 "결과 다시 보여줘" 같은 조회도 걸린다(#1064 리뷰).
const RETRY_ORDER =
  /다시\s*(?:해|돌려|실행해|시도해)|재실행|재시도|한\s*번\s*더\s*(?:해|돌려|실행해)/;

// 재실행을 말리거나 결과·방법을 묻는 문장. 규칙 경로는 분류기를 건너뛰고 실패 실행을 바로 다시 돌리므로
// — 코드 리뷰는 외부 게시까지 다시 시도한다 — 애매하면 분류기에 넘긴다.
const NOT_A_RETRY_ORDER =
  /하지\s*마|돌리지\s*마|말아|말고|그만|안\s*해도|방법|어떻게|왜|결과|보여|알려|조회/;

export const parseRunRetryRequest = (text: string): number | null => {
  const plainText = text.replace(/<[^>]*>/g, '');
  if (!RETRY_ORDER.test(plainText) || NOT_A_RETRY_ORDER.test(plainText)) {
    return null;
  }
  const match = /실행\s*번호\s*[`#:]?\s*(\d+)/.exec(plainText);
  if (!match) {
    return null;
  }
  const runId = Number(match[1]);
  return Number.isSafeInteger(runId) && runId > 0 ? runId : null;
};
