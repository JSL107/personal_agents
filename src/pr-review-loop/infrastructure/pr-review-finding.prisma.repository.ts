import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';
import { RejectedConventionRow } from '../../agent/code-reviewer/domain/prompt/learned-conventions';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryStatusCount } from '../domain/adoption-rate';
import {
  FindRejectionsForConventionsInput,
  HasAnyForPullRequestInput,
  MarkDecidedInput,
  OpenPostedPullRequestRow,
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
const OPEN_CARD_PULL_REQUEST_LIMIT = 20;

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
    const where = {
      status: 'OPEN',
      resolvedAt: null,
      githubCommentId: { not: null },
    } as const;
    const [pullRequests, allPullRequests] = await Promise.all([
      this.prisma.prReviewFinding.groupBy({
        by: ['repo', 'pullNumber'],
        where,
        _max: { createdAt: true },
        orderBy: [
          { _max: { createdAt: 'desc' } },
          { repo: 'asc' },
          { pullNumber: 'asc' },
        ],
        take: OPEN_CARD_PULL_REQUEST_LIMIT,
      }),
      this.prisma.prReviewFinding.groupBy({
        by: ['repo', 'pullNumber'],
        where,
      }),
    ]);
    if (allPullRequests.length > pullRequests.length) {
      this.logger.warn(
        `PR 리뷰 수확 대상 PR ${allPullRequests.length}건 중 최근 ${OPEN_CARD_PULL_REQUEST_LIMIT}건만 처리합니다. 이번 회차 제외: ${
          allPullRequests.length - pullRequests.length
        }건.`,
      );
    }
    if (pullRequests.length === 0) {
      return [];
    }
    const rows = await this.prisma.prReviewFinding.findMany({
      where: {
        ...where,
        OR: pullRequests.map(({ repo, pullNumber }) => ({
          repo,
          pullNumber,
        })),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toRecord(row));
  }

  async markDecided({
    id,
    status,
    rejectReason,
    githubThreadNodeId,
    resolveThread,
  }: MarkDecidedInput): Promise<void> {
    await this.prisma.prReviewFinding.update({
      where: { id },
      data: {
        status,
        rejectReason: status === 'REJECTED' ? rejectReason : null,
        githubThreadNodeId,
        decidedAt: new Date(),
        // 한 번의 쓰기로 확정한다. 나눠 쓰면 첫 쓰기 직후 실패했을 때 조회 대상에서
        // 빠져(status 가 OPEN 이 아니게 된다) 나머지 갱신을 재시도할 길이 없다.
        ...(resolveThread === true ? { resolvedAt: new Date() } : {}),
      },
    });
  }

  async countOpenPostedByPullRequest(): Promise<OpenPostedPullRequestRow[]> {
    const rows = await this.prisma.prReviewFinding.groupBy({
      by: ['repo', 'pullNumber'],
      where: {
        status: 'OPEN',
        resolvedAt: null,
        githubCommentId: { not: null },
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return rows.flatMap((row): OpenPostedPullRequestRow[] => {
      const oldestAt = row._min.createdAt;
      // groupBy 결과에 행이 있으면 createdAt 은 반드시 있다(NOT NULL). 타입만 좁힌다.
      if (oldestAt === null) {
        return [];
      }
      return [
        {
          repo: row.repo,
          pullNumber: row.pullNumber,
          count: row._count._all,
          oldestAt,
        },
      ];
    });
  }

  async markThreadResolved(id: number): Promise<void> {
    await this.prisma.prReviewFinding.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  // ponytail: 기간 제한 없이 전체 누적. 카테고리×상태 조합이라 행 수가 작아(현재 4×5 미만)
  // 비용이 무시할 수준이고, 원장의 계측 쿼리와 같은 범위라 대조가 쉽다. 카드가 수천 건
  // 쌓여 옛 데이터가 현재 품질을 가리기 시작하면 createdAt 하한을 넣는다.
  async countAdoptionByCategory(): Promise<CategoryStatusCount[]> {
    const rows = await this.prisma.prReviewFinding.groupBy({
      by: ['category', 'status'],
      _count: { _all: true },
    });
    return rows.map(({ category, status, _count }) => ({
      category,
      status,
      count: _count._all,
    }));
  }

  async findRejectionsForConventions(
    input: FindRejectionsForConventionsInput,
  ): Promise<RejectedConventionRow[]> {
    const rows = await this.prisma.prReviewFinding.findMany({
      where: {
        repo: input.repo,
        status: 'REJECTED',
        // 이유 없는 기각(👎 만 누른 경우)은 학습 재료가 아니다 — 무엇이 틀렸는지가 없다.
        rejectReason: { not: null },
        resolvedAt: { gte: input.since },
      },
      select: { category: true, rejectReason: true, resolvedAt: true },
      orderBy: { resolvedAt: 'desc' },
    });
    // rejectReason·resolvedAt 은 스키마상 nullable 이라 where 로 걸러도 타입이 좁혀지지 않는다.
    return rows.flatMap((row) => {
      if (row.rejectReason === null || row.resolvedAt === null) {
        return [];
      }
      return [
        {
          category: row.category,
          rejectReason: row.rejectReason,
          resolvedAt: row.resolvedAt,
        },
      ];
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
