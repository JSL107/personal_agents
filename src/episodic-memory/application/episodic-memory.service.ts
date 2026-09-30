import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import {
  EpisodeSearchHit,
  RecordEpisodeInput,
  SearchEpisodesInput,
} from '../domain/episode.type';
import { EMBEDDER_PORT, EmbedderPort } from '../domain/port/embedder.port';
import { EpisodicMemoryPort } from '../domain/port/episodic-memory.port';
import { EpisodicMemoryPrismaRepository } from '../infrastructure/episodic-memory.prisma.repository';

const MAX_CONTENT_CHARS = 4000;
const DEFAULT_HALF_LIFE_DAYS = 30;
const CANDIDATE_MULTIPLIER = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EpisodicMemoryService
  implements EpisodicMemoryPort, OnModuleDestroy
{
  private readonly logger = new Logger(EpisodicMemoryService.name);
  // 호출자(AgentRun finish)가 기다리지 않고 던진 적재. 종료 때 이것을 기다리지 않으면 임베딩이 끝난
  // 적재가 Prisma $disconnect 와 겹쳐 "Response from the Engine was empty" 로 유실된다
  // (review:replay 가 실행마다 마지막 run 의 에피소드를 잃던 원인). 전역 PrismaModule 은 가장 늦게
  // 닫히므로 여기서 기다리면 연결이 살아 있을 때 끝난다.
  private readonly pendingRecords = new Set<Promise<void>>();

  constructor(
    @Inject(EMBEDDER_PORT) private readonly embedder: EmbedderPort,
    private readonly repository: EpisodicMemoryPrismaRepository,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.pendingRecords);
  }

  record(input: RecordEpisodeInput): Promise<void> {
    const pending = this.recordOrSwallow(input);
    this.pendingRecords.add(pending);
    void pending.finally(() => this.pendingRecords.delete(pending));
    return pending;
  }

  // best-effort 적재 — 임베딩/DB 실패가 호출자(AgentRun finish) 본 흐름을 막지 않도록 swallow.
  private async recordOrSwallow(input: RecordEpisodeInput): Promise<void> {
    try {
      const content = input.content.slice(0, MAX_CONTENT_CHARS);
      if (content.trim().length === 0) {
        return;
      }
      const [embedding] = await this.embedder.embed([content], 'passage');
      await this.repository.insert({
        kind: input.kind,
        agentRunId: input.agentRunId,
        agentType: input.agentType,
        content,
        embedding,
        occurredAt: input.occurredAt,
      });
    } catch (error) {
      this.logger.warn(
        `EpisodicMemory record 실패 (swallow): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async searchRelevant(
    input: SearchEpisodesInput,
  ): Promise<EpisodeSearchHit[]> {
    const [embedding] = await this.embedder.embed([input.query], 'query');
    const candidates = await this.repository.searchByVector({
      embedding,
      kind: input.kind,
      agentType: input.agentType,
      limit: input.limit * CANDIDATE_MULTIPLIER,
    });

    const halfLifeDays = input.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
    const now = Date.now();
    return candidates
      .map((row) => {
        const similarity = 1 - row.distance; // cosine distance → similarity
        const ageDays = Math.max(0, (now - row.occurredAt.getTime()) / DAY_MS);
        const recencyWeight = Math.pow(2, -ageDays / halfLifeDays);
        return {
          id: row.id,
          agentRunId: row.agentRunId,
          agentType: row.agentType,
          content: row.content,
          score: similarity * recencyWeight,
          occurredAt: row.occurredAt,
        };
      })
      .sort((first, second) => second.score - first.score)
      .slice(0, input.limit);
  }
}
