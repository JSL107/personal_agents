import { JobSourceId } from '../domain/job-feed.type';
import { JobFeedRateLimitError } from './job-feed-rate-limit.error';

const MAX_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 1_000;

// 재시도해도 결과가 달라지지 않는 응답. 반복하면 차단만 앞당긴다.
const PERMANENT_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404]);

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
      if (PERMANENT_STATUSES.has(response.status)) {
        // 인증이 붙거나 차단된 경우다. 재시도하면 영구 실패를 반복한다.
        throw new Error(
          `${label} 요청 실패: HTTP ${response.status} (재시도 안 함)`,
        );
      }
      if (!response.ok) {
        throw new Error(`${label} 요청 실패: HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      const isPermanent = normalized.message.includes('재시도 안 함');
      if (isPermanent || attempt >= MAX_ATTEMPTS) {
        throw normalized;
      }
      lastError = normalized;
      await sleep(BACKOFF_BASE_MS * attempt);
    }
  }

  throw lastError ?? new Error(`${label} 요청 실패`);
};
