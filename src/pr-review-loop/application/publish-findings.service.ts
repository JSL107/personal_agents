import { Inject, Injectable, Logger } from '@nestjs/common';

import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import {
  FileHunkRanges,
  firstCommentableLine,
  parseDiffHunks,
  SNAP_MAX_DISTANCE,
  snapToCommentableLine,
} from '../domain/diff-hunk.parser';
import {
  buildFindingCommentBody,
  IDAERI_REVIEW_MARKER,
} from '../domain/finding-comment.body';
import { buildFindingFingerprint } from '../domain/finding-fingerprint';
import {
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import {
  CreateFindingInput,
  FindingPostMode,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';
import { PublishOutcome } from '../domain/publish-outcome.type';
import { isRepoAllowed, planPublication } from '../domain/publish-policy';

const AGENT_TYPE = 'CODE_REVIEWER';

export interface PublishFindingsInput {
  agentRunId: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  diff: string;
  findings: ReviewFinding[];
  max: number;
  dryRun: boolean;
  allowlistRaw: string | undefined;
}

@Injectable()
export class PublishFindingsService {
  private readonly logger = new Logger(PublishFindingsService.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
  ) {}

  async publish(input: PublishFindingsInput): Promise<PublishOutcome> {
    const outcome: PublishOutcome = {
      inline: 0,
      file: 0,
      issueComment: 0,
      dryRun: 0,
      notPosted: 0,
      dropped: 0,
      duplicate: 0,
    };
    const plan = planPublication({
      findings: input.findings,
      max: input.max,
    });

    // 연습 모드는 정책 계산(정렬·상한) + 집계만 하는 순수 미리보기다. 지문은 게시 여부를
    // 포함하지 않아 카드를 만들면 실게시로 전환할 때 "중복"으로 막혀 버린다 — DB 에 아예 쓰지 않는다.
    if (input.dryRun) {
      outcome.dryRun = plan.toPost.length;
      outcome.dropped = plan.dropped.length;
      return outcome;
    }

    const canPost = isRepoAllowed(input.repo, input.allowlistRaw);
    const hunks = parseDiffHunks(input.diff);
    const fallback: { record: PrReviewFindingRecord; body: string }[] = [];

    for (const finding of plan.toPost) {
      const record = await this.createCard({
        input,
        finding,
        // 게시 성공 시 markPosted 가 INLINE/FILE/ISSUE_COMMENT 로 갱신한다.
        postMode: 'NOT_POSTED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      if (!canPost) {
        outcome.notPosted += 1;
        continue;
      }
      await this.postWithFallback({
        input,
        finding,
        record,
        hunks,
        outcome,
        fallback,
      });
    }

    for (const finding of plan.dropped) {
      const record = await this.createCard({
        input,
        finding,
        postMode: 'NOT_POSTED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      outcome.dropped += 1;
    }

    if (fallback.length > 0) {
      await this.postGroupedComment({ input, fallback, outcome });
    }

    return outcome;
  }

  private async createCard({
    input,
    finding,
    postMode,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    postMode: FindingPostMode;
  }): Promise<PrReviewFindingRecord | null> {
    const filePath = finding.file ?? null;
    const createInput: CreateFindingInput = {
      agentRunId: input.agentRunId,
      agentType: AGENT_TYPE,
      repo: input.repo,
      pullNumber: input.pullNumber,
      headSha: input.headSha,
      category: finding.category,
      severity: finding.severity,
      filePath,
      line: finding.line ?? null,
      body: finding.body,
      fingerprint: buildFindingFingerprint({
        repo: input.repo,
        pullNumber: input.pullNumber,
        filePath,
        body: finding.body,
      }),
      postMode,
    };
    return this.repository.createIfAbsent(createInput);
  }

  // 1) 줄 단위 → 2) 파일 단위 → 3) 일반 코멘트 묶음. 지적이 조용히 유실되지 않게 한다.
  private async postWithFallback({
    input,
    finding,
    record,
    hunks,
    outcome,
    fallback,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    record: PrReviewFindingRecord;
    hunks: FileHunkRanges[];
    outcome: PublishOutcome;
    fallback: { record: PrReviewFindingRecord; body: string }[];
  }): Promise<void> {
    const filePath = finding.file;
    if (filePath === undefined) {
      fallback.push({ record, body: finding.body });
      return;
    }

    // line 이 없어도 파일 단위로 강등하지 않는다 — 파일 헤더에 붙은 코멘트는 어느 줄에 대한
    // 지적인지 보이지 않아 리뷰로서 쓸모가 없다. 그 파일 첫 변경 줄에 인라인으로 붙인다.
    const snapped =
      finding.line === undefined
        ? firstCommentableLine({ hunks, filePath })
        : snapToCommentableLine({
            hunks,
            filePath,
            line: finding.line,
            maxDistance: SNAP_MAX_DISTANCE,
          });

    let posted: { commentId: string; nodeId: string };
    try {
      posted = await this.githubClient.createReviewComment({
        repo: input.repo,
        pullNumber: input.pullNumber,
        commitSha: input.headSha,
        filePath,
        line: snapped,
        body: buildFindingCommentBody({
          category: finding.category,
          severity: finding.severity,
          body: finding.body,
        }),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `인라인 게시 실패, 일반 코멘트로 강등 (${filePath}:${snapped ?? 'file'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      fallback.push({ record, body: finding.body });
      return;
    }

    // 게시는 이미 성공했다 — DB 상태 갱신 실패는 지적 유실이 아니므로 집계·폴백에 영향을 주지 않는다.
    if (snapped === null) {
      outcome.file += 1;
    } else {
      outcome.inline += 1;
    }
    try {
      await this.repository.markPosted({
        id: record.id,
        postMode: snapped === null ? 'FILE' : 'INLINE',
        githubCommentId: posted.commentId,
        githubThreadNodeId: posted.nodeId,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `게시 성공, DB 상태 갱신 실패 (${filePath}:${snapped ?? 'file'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async postGroupedComment({
    input,
    fallback,
    outcome,
  }: {
    input: PublishFindingsInput;
    fallback: { record: PrReviewFindingRecord; body: string }[];
    outcome: PublishOutcome;
  }): Promise<void> {
    const lines = [
      `${IDAERI_REVIEW_MARKER} — 줄 앵커를 찾지 못해 묶어서 남깁니다.`,
      '',
      ...fallback.map((item) => `- ${item.body}`),
    ];
    try {
      await this.githubClient.addIssueComment({
        repo: input.repo,
        number: input.pullNumber,
        body: lines.join('\n'),
      });
    } catch (error: unknown) {
      this.logger.error(
        `일반 코멘트 강등까지 실패 — 카드는 NOT_POSTED 로 남는다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      outcome.notPosted += fallback.length;
      return;
    }

    // 게시는 이미 성공했다(묶음 코멘트 1건). 카드별 DB 상태 갱신 실패는 지적 유실이 아니므로
    // 집계는 게시 결과만 반영하고, markPosted 실패는 로그만 남긴다.
    for (const item of fallback) {
      outcome.issueComment += 1;
      try {
        await this.repository.markPosted({
          id: item.record.id,
          postMode: 'ISSUE_COMMENT',
          githubCommentId: null,
          githubThreadNodeId: null,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `게시 성공, DB 상태 갱신 실패 (id=${item.record.id}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
