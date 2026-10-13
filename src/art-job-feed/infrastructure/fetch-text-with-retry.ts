export interface FetchTextInput {
  url: string;
  timeoutMs: number;
  headers: Readonly<Record<string, string>>;
  label: string;
  method?: string;
  body?: string;
}

const sleep = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export const fetchTextWithRetry = async (
  input: FetchTextInput,
): Promise<string> => {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(input.url, {
        method: input.method ?? 'GET',
        headers: input.headers,
        body: input.body,
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      if (!response.ok) {
        const error = new Error(
          `${input.label} 요청 실패: HTTP ${response.status}`,
        );
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          throw Object.assign(error, { permanent: true });
        }
        throw error;
      }
      return await response.text();
    } catch (error) {
      if ((error as { permanent?: boolean }).permanent || attempt === 2) {
        throw error;
      }
      await sleep(1_000 * 2 ** attempt);
    }
  }
  throw new Error(`${input.label} 요청 실패`);
};
