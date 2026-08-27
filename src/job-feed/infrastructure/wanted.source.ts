import { Injectable } from '@nestjs/common';

import { JobSourceId, RawJobDetail } from '../domain/job-feed.type';
import { JobDetailSourcePort } from '../domain/port/job-detail-source.port';
import { JobSourceListResult } from '../domain/port/job-source.port';
import { fetchJsonWithRetry } from './fetch-with-retry';
import {
  DETAIL_REQUEST_TIMEOUT_MS,
  JSON_REQUEST_HEADERS,
  LIST_REQUEST_TIMEOUT_MS,
} from './http-constants';
import { mapWantedDetail, mapWantedList } from './wanted.mapper';

const LIST_ENDPOINT = 'https://www.wanted.co.kr/api/v4/jobs';
const DETAIL_ENDPOINT = 'https://www.wanted.co.kr/api/v4/jobs';
const PAGE_SIZE = 40;

// 백엔드 전용 category_tags 값을 확정하지 못했다. 잘못된 값을 넣으면 HTTP 200 으로
// 디자이너 공고가 정상 수집된다(실측 — category_tags=872 가 타이포그래피·Zeplin·UI 디자인).
// 그래서 카테고리를 좁히지 않고 개발 직군을 넓게 받은 뒤 isBackendPosting 으로 거른다.
@Injectable()
export class WantedSource implements JobDetailSourcePort {
  readonly source: JobSourceId = 'wanted';

  async fetchList(page: number): Promise<JobSourceListResult> {
    const offset = Math.max(0, (page - 1) * PAGE_SIZE);
    const parameters = new URLSearchParams({
      country: 'kr',
      job_sort: 'job.latest_order',
      years: '-1',
      locations: 'all',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const payload = await this.requestJson(
      `${LIST_ENDPOINT}?${parameters.toString()}`,
      LIST_REQUEST_TIMEOUT_MS,
    );
    return mapWantedList(payload);
  }

  async fetchDetail(sourceId: string): Promise<RawJobDetail> {
    const payload = await this.requestJson(
      `${DETAIL_ENDPOINT}/${encodeURIComponent(sourceId)}`,
      DETAIL_REQUEST_TIMEOUT_MS,
    );
    return mapWantedDetail(payload);
  }

  private async requestJson(url: string, timeoutMs: number): Promise<unknown> {
    return await fetchJsonWithRetry({
      source: this.source,
      url,
      timeoutMs,
      headers: JSON_REQUEST_HEADERS,
      label: '원티드',
    });
  }
}
