import { RawJobDetail } from '../job-feed.type';
import { JobSourcePort } from './job-source.port';

// 상세 본문을 줄 수 있는 소스만 이 계약을 만족한다. 랠릿은 상세 엔드포인트가 확인되지 않아
// 목록 계약만 구현한다 — 갭 분석 후보 선정에서 `'fetchDetail' in source` 로 걸러낸다.
export interface JobDetailSourcePort extends JobSourcePort {
  fetchDetail(sourceId: string): Promise<RawJobDetail>;
}

export const supportsDetail = (
  source: JobSourcePort,
): source is JobDetailSourcePort => {
  return 'fetchDetail' in source;
};
