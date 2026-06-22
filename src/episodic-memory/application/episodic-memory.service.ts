import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  EpisodeSearchHit,
  RecordEpisodeInput,
  SearchEpisodesInput,
} from '../domain/episode.type';
import { EMBEDDER_PORT, EmbedderPort } from '../domain/port/embedder.port';
import { EpisodicMemoryPort } from '../domain/port/episodic-memory.port';
import { EpisodicMemoryRepository } from '../infrastructure/episodic-memory.repository';

const MAX_CONTENT_CHARS = 4000;
const DEFAULT_HALF_LIFE_DAYS = 30;
const CANDIDATE_MULTIPLIER = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EpisodicMemoryService implements EpisodicMemoryPort {
  private readonly logger = new Logger(EpisodicMemoryService.name);

  constructor(
    @Inject(EMBEDDER_PORT) private readonly embedder: EmbedderPort,
    private readonly repository: EpisodicMemoryRepository,
  ) {}

  // best-effort 적재 — 임베딩/DB 실패가 호출자(AgentRun finish) 본 흐름을 막지 않도록 swallow.
  async record(input: RecordEpisodeInput): Promise<void> {
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
