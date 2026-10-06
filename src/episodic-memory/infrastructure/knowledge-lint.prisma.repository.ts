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

export interface BandPairRow {
  idA: number;
  idB: number;
  distance: number;
  contentA: string;
  contentB: string;
  occurredAt: Date;
}

// Knowledge-Lint 전용 조회 — episodic_memory 무결성 점검용 raw SQL.
// 판정(임계값 적용/이슈 분류)은 service 책임 — 여기선 후보 행만 반환한다(헥사고날: 비즈니스 규칙을 SQL 로 흘리지 않음).
// EpisodicMemoryPrismaRepository 와 같은 테이블을 보지만 책임(record/search vs lint)이 달라 분리.
@Injectable()
export class KnowledgeLintPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 각 행의 최근접 이웃(같은 kind, 자기 제외, 임베딩 보유) 중 maxDistance 이하인 것 전부를
  // 거리 오름차순으로. 임계값을 SQL 로 내리는 것은 판정을 여기로 옮기는 게 아니라(값은 호출자가 준다)
  // 전체 행을 application 으로 올리지 않기 위함이다 — 호출자가 총 쌍 수를 정확히 세려면
  // 잘리지 않은 목록이 필요하고, 그러려면 필터가 조회 단계에 있어야 한다.
  //
  // scanLimit 은 판정 임계가 아니라 폭주 안전망이다. 최근접이웃은 행당 1개라 반환 상한이 곧
  // 테이블 행 수이므로 현재 규모에서는 도달하지 않지만, 도달하면 호출자의 총계가 과소 보고된다.
  // pgvector 거리 인덱스가 있으면 LATERAL 근접쿼리가 빠르고, 없으면 풀스캔(소규모 가정 — 규모 커지면 인덱스 선행).
  async findNearestNeighbors(input: {
    maxDistance: number;
    scanLimit: number;
  }): Promise<NearestNeighborRow[]> {
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
        AND n.distance <= ${input.maxDistance}
      ORDER BY n.distance ASC
      LIMIT ${input.scanLimit}
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

  // 사실상 같은 글 중 오래된 쪽에 superseded_at 을 찍고 찍은 행 수를 돌려준다. 행은 지우지 않는다 —
  // 되돌리려면 이 회차에 찍힌 superseded_at 을 NULL 로 돌리면 된다.
  // 짝은 같은 kind·같은 agent_type 끼리만 본다: 검색(searchByVector)이 agent_type 으로 거르므로,
  // 다른 워커의 같은 글을 근거로 찍으면 이쪽 워커의 검색에서 그 기억이 통째로 사라진다.
  // "더 새것" 은 (occurred_at, id) 순서 — 같은 시각이면 id 가 큰 쪽이 남는다.
  // 한 문장 안의 EXISTS 는 문장 시작 시점 스냅샷을 보므로 A<B<C 묶음은 A·B 가 찍히고 C 만 남는다.
  // 거리 조건이라 벡터 인덱스를 못 타 풀스캔이다(1,700행 규모 가정 — 커지면 후보를 최근접이웃 조회로 좁힐 것).
  async supersedeOlderDuplicates(input: {
    maxDistance: number;
  }): Promise<number> {
    return await this.prisma.$executeRaw`
      UPDATE episodic_memory a
      SET superseded_at = now()
      WHERE a.superseded_at IS NULL
        AND a.embedding IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM episodic_memory b
          WHERE b.superseded_at IS NULL
            AND b.embedding IS NOT NULL
            AND b.kind = a.kind
            AND b.agent_type IS NOT DISTINCT FROM a.agent_type
            AND (b.occurred_at, b.id) > (a.occurred_at, a.id)
            AND (a.embedding <=> b.embedding) <= ${input.maxDistance}
        )
    `;
  }

  // L4 contradiction 후보 — 거리 밴드(minDistance < d <= maxDistance) 내 "유사하나 동일 아님" 쌍.
  // b.id > a.id 로 쌍을 SQL 단계에서 정규화(역쌍 제거) → service dedup 불필요.
  // judge 가 두 content 를 비교하므로 content + occurredAt(=a) 도 함께 반환.
  async findBandPairs(input: {
    minDistance: number;
    maxDistance: number;
    limit: number;
  }): Promise<BandPairRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id_a: number;
        id_b: number;
        distance: number;
        content_a: string;
        content_b: string;
        occurred_at: Date;
      }>
    >`
      SELECT
        a.id AS id_a,
        n.id AS id_b,
        n.distance AS distance,
        a.content AS content_a,
        n.content AS content_b,
        a.occurred_at AS occurred_at
      FROM episodic_memory a
      CROSS JOIN LATERAL (
        SELECT b.id, b.content, a.embedding <=> b.embedding AS distance
        FROM episodic_memory b
        WHERE b.id > a.id
          AND b.embedding IS NOT NULL
          AND b.superseded_at IS NULL
          AND b.kind = a.kind
        ORDER BY a.embedding <=> b.embedding
        LIMIT 1
      ) n
      WHERE a.embedding IS NOT NULL
        AND a.superseded_at IS NULL
        AND n.distance > ${input.minDistance}
        AND n.distance <= ${input.maxDistance}
      ORDER BY n.distance ASC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      idA: row.id_a,
      idB: row.id_b,
      distance: Number(row.distance),
      contentA: row.content_a,
      contentB: row.content_b,
      occurredAt: row.occurred_at,
    }));
  }
}
