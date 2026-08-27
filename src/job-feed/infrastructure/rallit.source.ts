import { Injectable } from '@nestjs/common';

import { JobSourceId } from '../domain/job-feed.type';
import {
  JobSourceListResult,
  JobSourcePort,
} from '../domain/port/job-source.port';
import { fetchJsonWithRetry } from './fetch-with-retry';
import {
  JSON_REQUEST_HEADERS,
  LIST_REQUEST_TIMEOUT_MS,
} from './http-constants';
import { mapRallitList } from './rallit.mapper';

const LIST_ENDPOINT = 'https://www.rallit.com/api/v1/position';
const PAGE_SIZE = 100;

// 직군 필터 파라미터를 찾지 못했다 — jobCategory·jobCategories·filter 는 무시되고(총 301건
// 동일) job= 은 결과가 0건이다. 개발 직군 전체를 받아 isBackendPosting 으로 거른다.
// 상세 엔드포인트도 확인되지 않아 fetchDetail 을 구현하지 않는다 — JobSourcePort 만 만족한다.
@Injectable()
export class RallitSource implements JobSourcePort {
  readonly source: JobSourceId = 'rallit';

  async fetchList(page: number): Promise<JobSourceListResult> {
    const parameters = new URLSearchParams({
      jobGroup: 'DEVELOPER',
      pageNumber: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const payload = await fetchJsonWithRetry({
      source: this.source,
      url: `${LIST_ENDPOINT}?${parameters.toString()}`,
      timeoutMs: LIST_REQUEST_TIMEOUT_MS,
      headers: JSON_REQUEST_HEADERS,
      label: '랠릿',
    });
    return mapRallitList(payload);
  }
}
