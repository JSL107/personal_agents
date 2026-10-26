import { Injectable } from '@nestjs/common';

import { MeasureBlogRevisionUsecase } from '../../../blog/application/measure-blog-revision.usecase';
import { hasRevisedLines } from '../../../blog/domain/has-revised-lines';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';

const LOOKBACK_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

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
      const report = await this.measureBlogRevision.execute();
      const since = Date.now() - LOOKBACK_DAYS * DAY_MS;
      const processedIds = new Set(processed.blogPostIds);
      const items = report.rows
        .filter(
          (row) => row.publishedAt.getTime() >= since && hasRevisedLines(row),
        )
        .map((row) => {
          // path 단독이면 같은 경로의 재발행을 놓친다. 발행 시각은 APPLIED 카드의 안정 값이다.
          const id = `blog:${row.path}:${row.publishedAt.toISOString()}`;
          const removed = row.changes?.removedLines.join('\n') ?? '';
          const added = row.changes?.addedLines.join('\n') ?? '';
          return {
            id,
            source: HumanizeResearchSource.BLOG,
            text: `발행 경로: ${row.path}\n삭제된 줄:\n${removed}\n최종본에 추가된 줄:\n${added}`,
          };
        })
        .filter((item) => !processedIds.has(item.id));
      return {
        source: HumanizeResearchSource.BLOG,
        status: items.length > 0 ? CollectionStatus.OK : CollectionStatus.EMPTY,
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
