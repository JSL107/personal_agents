import { JobSourceId } from '../domain/job-feed.type';
import { JobFeedPermanentError } from './job-feed-permanent.error';
import { JobFeedRateLimitError } from './job-feed-rate-limit.error';

const MAX_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 1_000;

// 429 는 별도 타입(JobFeedRateLimitError)으로 재시도 대상이다. 408 도 재시도 대상이다 —
// 서버가 유휴 연결을 닫거나 요청을 기다리다 타임아웃했을 때 보내는 것이라 다시 시도하면
// 성공할 수 있다(429 와 같은 성격). 나머지 4xx 는 인증·요청 형식 문제라 재시도해도 결과가
// 달라지지 않는다 — 반복하면 차단만 앞당긴다.
const isPermanentStatus = (status: number): boolean => {
  return status >= 400 && status < 500 && status !== 429 && status !== 408;
};

const sleep = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export interface FetchJsonInput {
  source: JobSourceId;
  url: string;
  timeoutMs: number;
  headers: Readonly<Record<string, string>>;
  label: string;
}

// 형태 검증은 매퍼가 한다. 여기서는 unknown 그대로 넘긴다.
export const fetchJsonWithRetry = async ({
  source,
  url,
  timeoutMs,
  headers,
  label,
}: FetchJsonInput): Promise<unknown> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 429) {
        throw new JobFeedRateLimitError(source);
      }
      if (isPermanentStatus(response.status)) {
        // 인증이 붙거나 차단된 경우다. 재시도하면 영구 실패를 반복한다.
        throw new JobFeedPermanentError(source, response.status, label);
      }
      if (!response.ok) {
        throw new Error(`${label} 요청 실패: HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      const isPermanent = normalized instanceof JobFeedPermanentError;
      if (isPermanent || attempt >= MAX_ATTEMPTS) {
        throw normalized;
      }
      lastError = normalized;
      await sleep(BACKOFF_BASE_MS * attempt);
    }
  }

  throw lastError ?? new Error(`${label} 요청 실패`);
};
