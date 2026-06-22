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
}

interface VectorSearchRow {
  id: number;
  agentRunId: number | null;
  distance: number;
  occurredAt: Date;
}

// pgvector 적재/검색은 Prisma 네이티브 미지원 → $queryRaw/$executeRaw 로만.
// 벡터는 '[..]' 리터럴을 Prisma.sql 파라미터로 바인딩 후 ::vector 캐스팅(injection 안전 — 숫자 배열).
@Injectable()
export class EpisodicMemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(input: InsertEpisodeRow): Promise<void> {
    const vector = this.toVectorLiteral(input.embedding);
    await this.prisma.$executeRaw`
      INSERT INTO episodic_memory (kind, agent_run_id, agent_type, content, embedding, occurred_at)
      VALUES (
        ${input.kind},
        ${input.agentRunId ?? null},
        ${input.agentType ?? null},
        ${input.content},
        ${vector}::vector,
        ${input.occurredAt}
      )
    `;
  }

  async searchByVector(input: {
    embedding: number[];
    kind?: EpisodeKind;
    agentType?: string;
    limit: number;
  }): Promise<VectorSearchRow[]> {
    const vector = this.toVectorLiteral(input.embedding);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        agent_run_id: number | null;
        distance: number;
        occurred_at: Date;
      }>
    >`
      SELECT
        id,
        agent_run_id,
        embedding <=> ${vector}::vector AS distance,
        occurred_at
      FROM episodic_memory
      WHERE
        embedding IS NOT NULL
        AND superseded_at IS NULL
        ${input.kind != null ? Prisma.sql`AND kind = ${input.kind}` : Prisma.empty}
        ${input.agentType != null ? Prisma.sql`AND agent_type = ${input.agentType}` : Prisma.empty}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      agentRunId: row.agent_run_id,
      distance: Number(row.distance),
      occurredAt: row.occurred_at,
    }));
  }

  // pgvector 리터럴: '[0.1,0.2,...]'. Prisma.sql 파라미터로 바인딩되므로 안전(숫자 배열).
  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
