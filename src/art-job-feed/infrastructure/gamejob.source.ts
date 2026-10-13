import { Injectable } from '@nestjs/common';

import { ArtJobListResult } from '../domain/art-job-feed.type';
import { ArtJobSourcePort } from '../domain/port/art-job-feed.ports';
import { fetchTextWithRetry } from './fetch-text-with-retry';
import { parseGamejobCompanyPhotos, parseGamejobList } from './gamejob.parser';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const REFERER =
  'https://www.gamejob.co.kr/Recruit/joblist?menucode=duty&duty=5';

@Injectable()
export class GamejobSource implements ArtJobSourcePort {
  async fetchLatest(page: number): Promise<ArtJobListResult> {
    const body = `condition[duty]=5&condition[menucode]=duty&page=${page}&direct=0&order=3&pagesize=40&tabcode=1`;
    const html = await fetchTextWithRetry({
      url: 'https://www.gamejob.co.kr/Recruit/_GI_Job_List/',
      timeoutMs: 10_000,
      label: '게임잡 목록',
      method: 'POST',
      body,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: REFERER,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
    });
    return parseGamejobList(html);
  }

  async fetchCompanyPhotoUrls(sourceId: string): Promise<string[]> {
    const html = await fetchTextWithRetry({
      url: `https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=${encodeURIComponent(sourceId)}`,
      timeoutMs: 10_000,
      label: '게임잡 상세',
      headers: { 'User-Agent': USER_AGENT },
    });
    return parseGamejobCompanyPhotos(html);
  }
}
