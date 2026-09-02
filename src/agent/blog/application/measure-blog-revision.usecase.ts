import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { FindRecentAppliedPreviewsUsecase } from '../../../preview-gate/application/find-recent-applied-previews.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  countRevision,
  RevisionCount,
  RevisionSummary,
  summarizeRevisions,
} from '../domain/revision-rate';

export interface BlogRevisionRow {
  path: string;
  publishedAt: Date;
  count: RevisionCount;
}

export interface BlogRevisionReport {
  rows: BlogRevisionRow[];
  summary: RevisionSummary;
  /** 짝을 못 찾은 글 수. 발행 뒤 경로가 바뀌거나 지워진 글이다. */
  unmatchedCount: number;
}

// 얼마나 오래된 발행본까지 볼 것인가. 주간 회차라 4주면 최근 흐름과 직전 구간이 함께 잡힌다.
const LOOKBACK_DAYS = 28;
// 한 회차에서 GitHub 을 두드리는 상한. 글이 하루 한 편이라 4주면 30편 이하다.
const FETCH_LIMIT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PublishedSnapshot {
  path: string;
  content: string;
  publishedAt: Date;
}

/**
 * 발행본과 최종본을 짝지어 사람이 얼마나 고쳤는지 잰다.
 *
 * 발행본은 실행 원장의 `output.content`(모델이 만들어 커밋한 그대로), 최종본은 블로그 저장소의
 * 현재 파일이다. 둘의 차이가 곧 「그 글이 얼마나 부족했나」다.
 *
 * LLM 을 부르지 않는다 — 원장 조회와 파일 조회, 그리고 줄 비교뿐이다.
 */
@Injectable()
export class MeasureBlogRevisionUsecase {
  private readonly logger = new Logger(MeasureBlogRevisionUsecase.name);

  constructor(
    private readonly findRecentAppliedPreviews: FindRecentAppliedPreviewsUsecase,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return (
      this.config.get<string>('BLOG_PUBLISH_REPO') !== undefined &&
      this.config.get<string>('BLOG_PUBLISH_BRANCH') !== undefined
    );
  }

  async execute(): Promise<BlogRevisionReport> {
    const repo = this.config.get<string>('BLOG_PUBLISH_REPO') ?? '';
    const branch = this.config.get<string>('BLOG_PUBLISH_BRANCH') ?? '';
    const published = await this.findPublished();

    const rows: BlogRevisionRow[] = [];
    let unmatchedCount = 0;
    for (const snapshot of published) {
      const final = await this.fetchFinal(repo, branch, snapshot.path);
      if (final === null) {
        unmatchedCount += 1;
        continue;
      }
      rows.push({
        path: snapshot.path,
        publishedAt: snapshot.publishedAt,
        count: countRevision(snapshot.content, final),
      });
    }

    return {
      rows,
      summary: summarizeRevisions(rows.map((row) => row.count)),
      unmatchedCount,
    };
  }

  /**
   * 실제로 커밋된 글만 모은다.
   *
   * **실행 원장(`BLOG_PUBLISH` AgentRun)을 쓰면 안 된다.** 그 회차는 승인 카드를 만든 시점에
   * 이미 SUCCEEDED 라(`output.status` 가 `ready`), 사용자가 거절하거나 만료된 카드의 본문까지
   * 발행본으로 집계된다. 실측(2026-09-02)상 성공 회차 14건 중 실제 발행은 10건이고, 저녁
   * 카드 쪽에는 CANCELLED 1건 · EXPIRED 5건이 남아 있다. 같은 초안을 다시 올리면 같은 경로로
   * 두 회차가 생겨 중복 집계되기도 한다.
   *
   * 승인된 카드(`APPLIED`)는 그 셋을 한 번에 푼다 — 실제로 커밋된 것만 남고, `appliedAt` 이
   * 발행 시각이며, 카드 하나가 발행 하나다.
   */
  private async findPublished(): Promise<PublishedSnapshot[]> {
    const previews = await this.findRecentAppliedPreviews.execute({
      kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
      since: new Date(Date.now() - LOOKBACK_DAYS * DAY_MS),
      limit: FETCH_LIMIT,
    });

    const snapshots: PublishedSnapshot[] = [];
    for (const preview of previews) {
      const payload = preview.payload as {
        path?: unknown;
        content?: unknown;
      } | null;
      if (
        typeof payload?.path !== 'string' ||
        typeof payload.content !== 'string' ||
        preview.appliedAt === null
      ) {
        // 이 필드가 없던 시절의 카드. 짝을 못 맞추므로 뺀다.
        continue;
      }
      snapshots.push({
        path: payload.path,
        content: payload.content,
        publishedAt: preview.appliedAt,
      });
    }
    return snapshots;
  }

  private async fetchFinal(
    repo: string,
    branch: string,
    path: string,
  ): Promise<string | null> {
    try {
      const file = await this.githubClient.getFileFromBranch({
        repo,
        branch,
        path,
      });
      return file.content ?? null;
    } catch (error: unknown) {
      // 지워졌거나 경로가 바뀐 글. 한 편이 없다고 회차 전체를 버리지 않는다 — 나머지 글의
      // 수정률은 여전히 유효하고, 빠진 편수는 호출자가 함께 보고한다.
      this.logger.warn(
        `최종본 조회 실패, 이 글은 건너뛴다 (${path}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
