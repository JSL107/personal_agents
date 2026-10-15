import { Injectable } from '@nestjs/common';

import { ArtJobListing, ArtJobListResult } from '../domain/art-job-feed.type';
import { splitRepresentativeGames } from '../domain/game-title';
import { ArtJobSourcePort } from '../domain/port/art-job-feed.ports';
import { fetchTextWithRetry } from './fetch-text-with-retry';
import {
  parseCompanyPageUrl,
  parseGamejobList,
  parseRepresentativeGameText,
} from './gamejob.parser';

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

  async fetchRepresentativeGames(listing: ArtJobListing): Promise<string[]> {
    const detail = await fetchTextWithRetry({
      url: listing.detailUrl,
      timeoutMs: 10_000,
      label: '게임잡 공고 상세',
      headers: { 'User-Agent': USER_AGENT },
    });
    const companyUrl = parseCompanyPageUrl(detail);
    if (!companyUrl) {
      return [];
    }
    const company = await fetchTextWithRetry({
      url: companyUrl,
      timeoutMs: 10_000,
      label: '게임잡 회사 정보',
      headers: { 'User-Agent': USER_AGENT },
    });
    const text = parseRepresentativeGameText(company);
    return text ? splitRepresentativeGames(text) : [];
  }
}
