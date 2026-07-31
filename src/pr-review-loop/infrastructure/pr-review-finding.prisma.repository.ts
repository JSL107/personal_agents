import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
  HasAnyForPullRequestInput,
  MarkDecidedInput,
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
  private readonly logger = new Logger(PrReviewFindingPrismaRepository.name);

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

  async findOpenPostedCards(): Promise<PrReviewFindingRecord[]> {
    const where = { status: 'OPEN', githubCommentId: { not: null } } as const;
    const [rows, totalCount] = await Promise.all([
      this.prisma.prReviewFinding.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.prReviewFinding.count({ where }),
    ]);
    if (totalCount > rows.length) {
      this.logger.warn(
        `PR 리뷰 수확 대상이 ${totalCount}건이라 오래된 200건만 처리합니다.`,
      );
    }
    return rows.map((row) => this.toRecord(row));
  }

  async markDecided({
    id,
    status,
    rejectReason,
    githubThreadNodeId,
  }: MarkDecidedInput): Promise<void> {
    await this.prisma.prReviewFinding.update({
      where: { id },
      data: {
        status,
        rejectReason: status === 'REJECTED' ? rejectReason : null,
        githubThreadNodeId,
        decidedAt: new Date(),
      },
    });
  }

  async markResolved(id: number): Promise<void> {
    await this.prisma.prReviewFinding.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
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
    githubThreadNodeId: string | null;
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
      githubThreadNodeId: row.githubThreadNodeId,
      createdAt: row.createdAt,
    };
  }
}
