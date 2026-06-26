import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

export interface NearestNeighborRow {
  id: number;
  relatedId: number;
  distance: number;
  occurredAt: Date;
}

export interface EmbeddingNullRow {
  id: number;
  occurredAt: Date;
}

// Knowledge-Lint 전용 조회 — episodic_memory 무결성 점검용 raw SQL.
// 판정(임계값 적용/이슈 분류)은 service 책임 — 여기선 후보 행만 반환한다(헥사고날: 비즈니스 규칙을 SQL 로 흘리지 않음).
// EpisodicMemoryRepository 와 같은 테이블을 보지만 책임(record/search vs lint)이 달라 분리.
@Injectable()
export class KnowledgeLintRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 각 행의 최근접 이웃(같은 kind, 자기 제외, 임베딩 보유)을 거리 오름차순으로 limit 개.
  // pgvector 거리 인덱스가 있으면 LATERAL 근접쿼리가 빠르고, 없으면 풀스캔(소규모 가정 — 규모 커지면 인덱스 선행).
  async findNearestNeighbors(limit: number): Promise<NearestNeighborRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        related_id: number;
        distance: number;
        occurred_at: Date;
      }>
    >`
      SELECT
        a.id AS id,
        n.id AS related_id,
        n.distance AS distance,
        a.occurred_at AS occurred_at
      FROM episodic_memory a
      CROSS JOIN LATERAL (
        SELECT b.id, a.embedding <=> b.embedding AS distance
        FROM episodic_memory b
        WHERE b.id <> a.id
          AND b.embedding IS NOT NULL
          AND b.superseded_at IS NULL
          AND b.kind = a.kind
        ORDER BY a.embedding <=> b.embedding
        LIMIT 1
      ) n
      WHERE a.embedding IS NOT NULL
        AND a.superseded_at IS NULL
      ORDER BY n.distance ASC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      relatedId: row.related_id,
      distance: Number(row.distance),
      occurredAt: row.occurred_at,
    }));
  }

  // 임베딩이 비어 벡터 검색(embedding IS NOT NULL 필터)에서 영원히 누락되는 행(superseded 제외).
  async findEmbeddingNull(limit: number): Promise<EmbeddingNullRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: number; occurred_at: Date }>
    >`
      SELECT id, occurred_at
      FROM episodic_memory
      WHERE embedding IS NULL
        AND superseded_at IS NULL
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({ id: row.id, occurredAt: row.occurred_at }));
  }
}
