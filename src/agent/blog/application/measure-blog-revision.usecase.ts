import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { AgentType } from '../../../model-router/domain/model-router.type';
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
    private readonly agentRunService: AgentRunService,
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

  private async findPublished(): Promise<PublishedSnapshot[]> {
    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType: AgentType.BLOG_PUBLISH,
      sinceDays: LOOKBACK_DAYS,
      limit: FETCH_LIMIT,
    });

    const snapshots: PublishedSnapshot[] = [];
    for (const run of runs) {
      const output = run.output as { path?: unknown; content?: unknown } | null;
      if (
        typeof output?.path !== 'string' ||
        typeof output.content !== 'string'
      ) {
        // 원장에는 이 필드가 없던 시절의 회차가 섞여 있다. 짝을 못 맞추므로 뺀다.
        continue;
      }
      snapshots.push({
        path: output.path,
        content: output.content,
        publishedAt: run.endedAt,
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
