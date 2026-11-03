import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { EpisodeKind } from '../domain/episode.type';

interface InsertEpisodeRow {
  kind: EpisodeKind;
  agentRunId?: number;
  agentType?: string;
  content: string;
  embedding: number[];
  occurredAt: Date;
  skipIfSameContent?: boolean;
}

interface VectorSearchRow {
  id: number;
  agentRunId: number | null;
  agentType: string | null;
  content: string;
  distance: number;
  occurredAt: Date;
}

// pgvector 적재/검색은 Prisma 네이티브 미지원 → $queryRaw/$executeRaw 로만.
// 벡터는 '[..]' 리터럴을 Prisma.sql 파라미터로 바인딩 후 ::vector 캐스팅(injection 안전 — 숫자 배열).
@Injectable()
export class EpisodicMemoryPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 넣은 행 수(0 또는 1)를 돌려준다 — skipIfSameContent 로 건너뛰면 0.
  async insert(input: InsertEpisodeRow): Promise<number> {
    const vector = this.toVectorLiteral(input.embedding);
    // shortcut: 동시에 같은 문장이 둘 들어오면 둘 다 들어갈 수 있다 — 판정이 같은 문장을 접으므로
    // 결과는 같다. 사본이 실제로 쌓이면 (kind, agent_type, content) unique 인덱스로 올린다.
    const duplicateGuard = input.skipIfSameContent
      ? Prisma.sql`WHERE NOT EXISTS (
          SELECT 1 FROM episodic_memory
          WHERE kind = ${input.kind}::text
            AND agent_type IS NOT DISTINCT FROM ${input.agentType ?? null}::text
            AND content = ${input.content}::text
            AND superseded_at IS NULL
        )`
      : Prisma.empty;
    return await this.prisma.$executeRaw`
      INSERT INTO episodic_memory (kind, agent_run_id, agent_type, content, embedding, occurred_at)
      -- VALUES 가 아니라 SELECT 라 열 타입으로 추론되지 않을 수 있어 캐스트를 명시한다.
      SELECT
        ${input.kind}::text,
        ${input.agentRunId ?? null}::integer,
        ${input.agentType ?? null}::text,
        ${input.content}::text,
        ${vector}::vector,
        ${input.occurredAt}::timestamp
      ${duplicateGuard}
    `;
  }

  async searchByVector(input: {
    embedding: number[];
    kind?: EpisodeKind;
    agentType?: string;
    limit: number;
    exact?: boolean;
  }): Promise<VectorSearchRow[]> {
    const vector = this.toVectorLiteral(input.embedding);
    // `+ 0` 은 정렬식이 HNSW 연산자와 달라지게 해 인덱스를 못 타게 한다(정확 검색). 근사 검색은
    // 후보를 먼저 뽑고 kind 로 거르므로, 행이 적은 kind 는 결과가 비어 버릴 수 있다.
    const orderBy = input.exact
      ? Prisma.sql`ORDER BY (embedding <=> ${vector}::vector) + 0`
      : Prisma.sql`ORDER BY embedding <=> ${vector}::vector`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        agent_run_id: number | null;
        agent_type: string | null;
        content: string;
        distance: number;
        occurred_at: Date;
      }>
    >`
      SELECT
        id,
        agent_run_id,
        agent_type,
        content,
        embedding <=> ${vector}::vector AS distance,
        occurred_at
      FROM episodic_memory
      WHERE
        embedding IS NOT NULL
        AND superseded_at IS NULL
        ${input.kind != null ? Prisma.sql`AND kind = ${input.kind}` : Prisma.empty}
        ${input.agentType != null ? Prisma.sql`AND agent_type = ${input.agentType}` : Prisma.empty}
      ${orderBy}
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      agentRunId: row.agent_run_id,
      agentType: row.agent_type,
      content: row.content,
      distance: Number(row.distance),
      occurredAt: row.occurred_at,
    }));
  }

  // pgvector 리터럴: '[0.1,0.2,...]'. Prisma.sql 파라미터로 바인딩되므로 안전(숫자 배열).
  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
