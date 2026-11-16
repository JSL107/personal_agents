import { Injectable } from '@nestjs/common';

import { MeasureBlogRevisionUsecase } from '../../../blog/application/measure-blog-revision.usecase';
import { hasRevisedLines } from '../../../blog/domain/has-revised-lines';
import {
  hashBlogChanges,
  renderBlogEditSummary,
  summarizeBlogEdits,
} from '../../domain/blog-edit-summary';
import {
  BLOG_LOOKBACK_DAYS,
  DAY_MS,
  statusOfItems,
} from '../../domain/humanize-research.constant';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';

@Injectable()
export class BlogRevisionCollector {
  constructor(
    private readonly measureBlogRevision: MeasureBlogRevisionUsecase,
  ) {}

  async collect(processed: Processed): Promise<CollectionResult> {
    if (!this.measureBlogRevision.isConfigured()) {
      return {
        source: HumanizeResearchSource.BLOG,
        status: CollectionStatus.EMPTY,
        items: [],
      };
    }
    try {
      const report = await this.measureBlogRevision.execute({
        lookbackDays: BLOG_LOOKBACK_DAYS,
      });
      const since = Date.now() - BLOG_LOOKBACK_DAYS * DAY_MS;
      const processedIds = new Set(processed.blogPostIds);
      const items = report.rows
        .filter((row) => row.publishedAt.getTime() >= since)
        .filter(hasRevisedLines)
        .filter((row) => {
          const legacyId = `blog:${row.path}:${row.publishedAt.toISOString()}`;
          return !processedIds.has(legacyId);
        })
        .map((row) => {
          const changes = row.changes ?? { removedLines: [], addedLines: [] };
          const summary = summarizeBlogEdits(changes);
          const hash = hashBlogChanges(changes);
          const id = `blog:${row.path}:${row.publishedAt.toISOString()}:${hash}`;
          return {
            id,
            source: HumanizeResearchSource.BLOG,
            text: renderBlogEditSummary({ path: row.path, summary }),
          };
        })
        .filter((item) => !processedIds.has(item.id));
      return {
        source: HumanizeResearchSource.BLOG,
        status: statusOfItems(items),
        items,
      };
    } catch (error: unknown) {
      return {
        source: HumanizeResearchSource.BLOG,
        status: CollectionStatus.FAILED,
        items: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
