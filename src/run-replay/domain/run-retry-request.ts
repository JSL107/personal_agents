// 재실행을 말리거나 방법을 묻는 문장. 규칙 경로는 분류기를 건너뛰고 실패 실행을 바로 다시 돌리므로,
// "실행번호 123 다시 하지 마" · "다시 돌리는 방법 알려줘" 가 실행되지 않게 분류기에 넘긴다.
const NOT_A_RETRY_ORDER =
  /하지\s*마|돌리지\s*마|말아|그만|안\s*해도|방법|어떻게|왜/;

export const parseRunRetryRequest = (text: string): number | null => {
  const plainText = text.replace(/<[^>]*>/g, '');
  if (
    !/다시|재실행|재시도|한\s*번\s*더/.test(plainText) ||
    NOT_A_RETRY_ORDER.test(plainText)
  ) {
    return null;
  }
  const match = /실행\s*번호\s*[`#:]?\s*(\d+)/.exec(plainText);
  if (!match) {
    return null;
  }
  const runId = Number(match[1]);
  return Number.isSafeInteger(runId) && runId > 0 ? runId : null;
};
