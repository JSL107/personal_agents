export const parseRunRetryRequest = (text: string): number | null => {
  const plainText = text.replace(/<[^>]*>/g, '');
  if (!/다시|재실행|재시도|한\s*번\s*더/.test(plainText)) {
    return null;
  }
  const match = /실행\s*번호\s*[`#:]?\s*(\d+)/.exec(plainText);
  if (!match) {
    return null;
  }
  const runId = Number(match[1]);
  return Number.isSafeInteger(runId) && runId > 0 ? runId : null;
};
