import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
  HasAnyForPullRequestInput,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import {
  CreateFindingInput,
  FindingPostMode,
  FindingStatus,
  MarkPostedInput,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class PrReviewFindingPrismaRepository implements PrReviewFindingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createIfAbsent(
    input: CreateFindingInput,
  ): Promise<PrReviewFindingRecord | null> {
    try {
      const created = await this.prisma.prReviewFinding.create({
        data: input,
      });
      return this.toRecord(created);
    } catch (error: unknown) {
      if (this.isDuplicateFingerprint(error)) {
        return null;
      }
      throw error;
    }
  }

  async hasAnyForPullRequest({
    repo,
    pullNumber,
  }: HasAnyForPullRequestInput): Promise<boolean> {
    const count = await this.prisma.prReviewFinding.count({
      where: { repo, pullNumber },
    });
    return count > 0;
  }

  async markPosted({
    id,
    postMode,
    githubCommentId,
    githubThreadNodeId,
  }: MarkPostedInput): Promise<void> {
    await this.prisma.prReviewFinding.update({
      where: { id },
      data: {
        postMode,
        githubCommentId:
          githubCommentId === null ? null : BigInt(githubCommentId),
        githubThreadNodeId,
      },
    });
  }

  private isDuplicateFingerprint(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    );
  }

  // BigInt 는 도메인·JSON 경계에서 문자열로 변환한다.
  private toRecord(row: {
    id: number;
    agentRunId: number;
    repo: string;
    pullNumber: number;
    headSha: string;
    category: string;
    severity: string;
    filePath: string | null;
    line: number | null;
    body: string;
    fingerprint: string;
    status: string;
    postMode: string;
    githubCommentId: bigint | null;
    createdAt: Date;
  }): PrReviewFindingRecord {
    return {
      id: row.id,
      agentRunId: row.agentRunId,
      repo: row.repo,
      pullNumber: row.pullNumber,
      headSha: row.headSha,
      category: row.category as FindingCategory,
      severity: row.severity as FindingSeverity,
      filePath: row.filePath,
      line: row.line,
      body: row.body,
      fingerprint: row.fingerprint,
      status: row.status as FindingStatus,
      postMode: row.postMode as FindingPostMode,
      githubCommentId:
        row.githubCommentId === null ? null : row.githubCommentId.toString(),
      createdAt: row.createdAt,
    };
  }
}
