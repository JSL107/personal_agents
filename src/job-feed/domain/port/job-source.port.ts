import { JobSourceId, RawJobPosting } from '../job-feed.type';

export const JOB_SOURCES = Symbol('JOB_SOURCES');

export interface JobSourceListResult {
  // 원시 수신 건수. 검증에서 걸러진 항목까지 포함한다 —
  // "수신은 있는데 검증 0" 을 구분해야 응답 형태 변경을 잡을 수 있다.
  received: number;
  postings: RawJobPosting[];
  totalPages: number;
}

export interface JobSourcePort {
  readonly source: JobSourceId;
  fetchList(page: number): Promise<JobSourceListResult>;
}
