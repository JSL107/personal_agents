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

// 원티드 개발 직군 태그. 파라미터 이름이 category_tags 가 아니라 tag_type_ids 다 —
// category_tags 로 넣으면 HTTP 200 에 전 직군(마케터·MD·기획)이 정상 응답으로 돌아온다(실측).
// 872 는 백엔드 전용이 아니라 개발 직군 전반이라 네트워크 엔지니어·컨설턴트도 섞인다.
// 나머지는 isBackendPosting 이 거른다.
const DEVELOPER_TAG_TYPE_ID = '872';

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
      tag_type_ids: DEVELOPER_TAG_TYPE_ID,
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
