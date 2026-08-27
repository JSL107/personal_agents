import { JobSourceId } from '../domain/job-feed.type';

// 4xx(429 제외) 응답 — 재시도해도 결과가 달라지지 않는다. 문자열 마커 대신 타입으로
// 판별해야 새 예외 경로가 추가돼도 영구/일시 구분이 깨지지 않는다.
export class JobFeedPermanentError extends Error {
  constructor(
    readonly source: JobSourceId,
    readonly httpStatus: number,
    label: string,
  ) {
    super(`${label} 요청 실패: HTTP ${httpStatus} (재시도 안 함)`);
    this.name = 'JobFeedPermanentError';
  }
}
