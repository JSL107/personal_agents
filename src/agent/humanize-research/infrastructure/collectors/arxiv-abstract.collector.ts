import { Injectable } from '@nestjs/common';

import { extractArxivEntries } from '../../domain/arxiv-atom';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';

const ENDPOINT = 'https://export.arxiv.org/api/query';
const SEARCH_QUERY =
  'cat:cs.CL AND (all:translationese OR all:"post-editese" OR all:"machine-generated text detection" OR all:Korean)';
// 실측 응답 15.5초(2026-10-26). 주 1회 호출이라 넉넉히 둔다.
const REQUEST_TIMEOUT_MS = 30_000;
const LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ARTICLE_LIMIT = 10;

@Injectable()
export class ArxivAbstractCollector {
  async collect(processed: Processed): Promise<CollectionResult> {
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set('search_query', SEARCH_QUERY);
      url.searchParams.set('sortBy', 'submittedDate');
      url.searchParams.set('sortOrder', 'descending');
      url.searchParams.set('max_results', '100');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`arXiv API HTTP ${response.status}`);
      }
      const xml = await response.text();
      if (
        !/<feed(?:\s|>)/u.test(xml) ||
        xml.includes('arxiv.org/api/errors#')
      ) {
        throw new Error('arXiv API 응답이 정상 Atom feed가 아니다');
      }
      const entries = extractArxivEntries(xml);
      const since = Date.now() - LOOKBACK_DAYS * DAY_MS;
      const processedIds = new Set(processed.arxivIds);
      const items = entries
        .filter((entry) => entry.published.getTime() >= since)
        .map((entry) => {
          const versionlessId = entry.id
            .replace(/^.*\/abs\//u, '')
            .replace(/v\d+$/u, '');
          return {
            id: `arxiv:${versionlessId}`,
            source: HumanizeResearchSource.ARXIV,
            text: `${entry.title}\n${entry.summary}`,
          };
        })
        .filter((item) => item.id !== 'arxiv:' && !processedIds.has(item.id))
        .slice(0, ARTICLE_LIMIT);
      return {
        source: HumanizeResearchSource.ARXIV,
        status: items.length > 0 ? CollectionStatus.OK : CollectionStatus.EMPTY,
        items,
      };
    } catch (error: unknown) {
      return {
        source: HumanizeResearchSource.ARXIV,
        status: CollectionStatus.FAILED,
        items: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
