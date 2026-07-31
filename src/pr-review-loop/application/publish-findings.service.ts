import { Inject, Injectable, Logger } from '@nestjs/common';

import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import {
  FileHunkRanges,
  parseDiffHunks,
  SNAP_MAX_DISTANCE,
  snapToCommentableLine,
} from '../domain/diff-hunk.parser';
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
    const canPost =
      !input.dryRun && isRepoAllowed(input.repo, input.allowlistRaw);
    const hunks = parseDiffHunks(input.diff);
    const fallback: { record: PrReviewFindingRecord; body: string }[] = [];

    for (const finding of plan.toPost) {
      const record = await this.createCard({
        input,
        finding,
        // 게시 성공 시 markPosted 가 INLINE/FILE/ISSUE_COMMENT 로 갱신한다.
        postMode: input.dryRun ? 'DRY_RUN' : 'NOT_POSTED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      if (input.dryRun) {
        outcome.dryRun += 1;
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

    const snapped =
      finding.line === undefined
        ? null
        : snapToCommentableLine({
            hunks,
            filePath,
            line: finding.line,
            maxDistance: SNAP_MAX_DISTANCE,
          });

    try {
      const posted = await this.githubClient.createReviewComment({
        repo: input.repo,
        pullNumber: input.pullNumber,
        commitSha: input.headSha,
        filePath,
        line: snapped,
        body: finding.body,
      });
      await this.repository.markPosted({
        id: record.id,
        postMode: snapped === null ? 'FILE' : 'INLINE',
        githubCommentId: posted.commentId,
        githubThreadNodeId: posted.nodeId,
      });
      if (snapped === null) {
        outcome.file += 1;
        return;
      }
      outcome.inline += 1;
    } catch (error: unknown) {
      this.logger.warn(
        `인라인 게시 실패, 일반 코멘트로 강등 (${filePath}:${snapped ?? 'file'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      fallback.push({ record, body: finding.body });
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
      '이대리 리뷰 — 줄 앵커를 찾지 못해 묶어서 남깁니다.',
      '',
      ...fallback.map((item) => `- ${item.body}`),
    ];
    try {
      await this.githubClient.addIssueComment({
        repo: input.repo,
        number: input.pullNumber,
        body: lines.join('\n'),
      });
      for (const item of fallback) {
        await this.repository.markPosted({
          id: item.record.id,
          postMode: 'ISSUE_COMMENT',
          githubCommentId: null,
          githubThreadNodeId: null,
        });
        outcome.issueComment += 1;
      }
    } catch (error: unknown) {
      this.logger.error(
        `일반 코멘트 강등까지 실패 — 카드는 NOT_POSTED 로 남는다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      outcome.notPosted += fallback.length;
    }
  }
}
