import { Injectable, Logger } from '@nestjs/common';

import { JobSourceId, RawJobDetail } from '../domain/job-feed.type';
import { JobDetailSourcePort } from '../domain/port/job-detail-source.port';
import { JobSourceListResult } from '../domain/port/job-source.port';
import { fetchJsonWithRetry } from './fetch-with-retry';
import {
  DETAIL_REQUEST_TIMEOUT_MS,
  JSON_REQUEST_HEADERS,
  LIST_REQUEST_TIMEOUT_MS,
} from './http-constants';
import { mapJumpitDetail, mapJumpitList } from './jumpit.mapper';

const LIST_ENDPOINT = 'https://jumpit-api.saramin.co.kr/api/positions';
const DETAIL_ENDPOINT = 'https://jumpit-api.saramin.co.kr/api/position';
// 점핏의 서버/백엔드 직군 코드. 실측으로 확인한 값이다(전체 126건).
const BACKEND_JOB_CATEGORY = '1';

@Injectable()
export class JumpitSource implements JobDetailSourcePort {
  readonly source: JobSourceId = 'jumpit';
  private readonly logger = new Logger(JumpitSource.name);

  async fetchList(page: number): Promise<JobSourceListResult> {
    const parameters = new URLSearchParams({
      page: String(page),
      jobCategory: BACKEND_JOB_CATEGORY,
      sort: 'rsp_rate',
    });
    const payload = await this.requestJson(
      `${LIST_ENDPOINT}?${parameters.toString()}`,
      LIST_REQUEST_TIMEOUT_MS,
    );
    return mapJumpitList(payload);
  }

  async fetchDetail(sourceId: string): Promise<RawJobDetail> {
    const payload = await this.requestJson(
      `${DETAIL_ENDPOINT}/${encodeURIComponent(sourceId)}`,
      DETAIL_REQUEST_TIMEOUT_MS,
    );
    return mapJumpitDetail(payload);
  }

  private async requestJson(url: string, timeoutMs: number): Promise<unknown> {
    return await fetchJsonWithRetry({
      source: this.source,
      url,
      timeoutMs,
      headers: JSON_REQUEST_HEADERS,
      label: '점핏',
    });
  }
}
